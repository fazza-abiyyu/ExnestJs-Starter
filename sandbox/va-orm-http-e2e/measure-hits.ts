// Berapa banyak HTTP request ("hit") per operasi ORM?
//
// Dipakai untuk memastikan tidak ada N+1 diam-diam dan memberi angka pasti
// untuk biaya transport HTTP.

import { VaClient } from "@v-va/orm";
import { SchemaParser } from "@v-va/orm/schema";
import { startMiniServer } from "./test/harness.js";

const SCHEMA = `
datasource db { provider = "postgresql" url = "postgres://localhost:5432/test" }
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
  @@map("users")
}
model Post {
  id     Int    @id @default(autoincrement())
  title  String
  userId Int
  author User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("posts")
}
`;

let hits = 0;
const statements: string[] = [];

const server = await startMiniServer({ MINI_PG_BACKEND: "memory" });

const countingFetch = (async (url: any, init: any) => {
  hits++;
  statements.push(JSON.parse(init.body).sql);
  return fetch(url, init);
}) as any;

const va = VaClient.create({
  driver: "http",
  dsn: `${server.url}/sql`,
  http: { protocol: "generic", fetch: countingFetch },
  schema: new SchemaParser().parse(SCHEMA),
  models: { user: { tableName: "users" }, post: { tableName: "posts" } },
});

await va
  .repository("user")
  .raw("CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, email text)");
await va
  .repository("post")
  .raw(
    "CREATE TABLE IF NOT EXISTS posts (id serial PRIMARY KEY, title text, userid integer)",
  );
await va
  .repository("user")
  .createMany([{ email: "a@x.dev" }, { email: "b@x.dev" }]);
await va.repository("post").createMany([{ title: "P1", userId: 1 } as any]);

async function measure(label: string, fn: () => Promise<unknown>) {
  hits = 0;
  statements.length = 0;
  await fn();
  console.log(
    `${label.padEnd(38)} ${String(hits).padStart(2)} hit  ${statements[0]?.slice(0, 60) ?? ""}`,
  );
}

await measure("findUnique", () => va.repository("user").findUnique({ id: 1 }));
await measure("findFirst", () =>
  va.repository("user").findFirst({ email: "a@x.dev" } as any),
);
await measure("findMany", () => va.repository("user").findMany({}));
await measure("findMany + where + orderBy", () =>
  va.repository("user").findMany({
    where: { email: "a@x.dev" } as any,
    orderBy: { email: "asc" } as any,
  }),
);
await measure("count", () => va.repository("user").count());
await measure("exists", () =>
  va.repository("user").exists({ email: "a@x.dev" } as any),
);
await measure("create", () =>
  va.repository("user").create({ email: "c@x.dev" }),
);
await measure("createMany (2 baris)", () =>
  va
    .repository("user")
    .createMany([{ email: "d@x.dev" }, { email: "e@x.dev" }]),
);
await measure("update", () =>
  va.repository("user").update({ id: 1 } as any, { email: "z@x.dev" } as any),
);
await measure("updateMany", () =>
  va
    .repository("user")
    .updateMany({ email: "z@x.dev" } as any, { email: "y@x.dev" } as any),
);
await measure("upsert", () =>
  va
    .repository("user")
    .upsert({ email: "u@x.dev" } as any, ["email"], ["email"]),
);
await measure("delete", () => va.repository("user").delete({ id: 2 } as any));
await measure("deleteMany", () =>
  va.repository("user").deleteMany({ email: "y@x.dev" } as any),
);
await measure("deleteAll", () => va.repository("user").deleteAll());
await measure("paginate (findMany + count)", () =>
  va.repository("user").paginate({ page: 1, limit: 10 }),
);
await measure("raw", () => va.repository("user").raw('SELECT * FROM "users"'));
await measure("model().findMany", () => va.model("user").findMany({}));

// Seed dulu: include loader early-return kalau tidak ada parent.
await va.repository("user").create({ email: "inc@x.dev" });
await va.repository("post").create({ title: "IP", userId: 1 } as any);
await measure("model().findMany + include", () =>
  va.model("user").findMany({ include: { posts: true } } as any),
);
await measure("model().count", () => va.model("user").count());
await measure("model().aggregate", () =>
  va.model("user").aggregate({ _count: true } as any),
);
await measure("model().groupBy", () =>
  va.model("user").groupBy({ by: ["email"], _count: true } as any),
);
await measure("model().create (delegate)", () =>
  va.model("user").create({ data: { email: "m@x.dev" } } as any),
);
await measure("model().create + nested write", () =>
  va.model("user").create({
    data: { email: "n@x.dev", posts: { create: [{ title: "NP" }] } },
  } as any),
);

// ---- protokol ber-session (turso): transaksi = BEGIN + stmt + COMMIT ----
const tursoHits = { n: 0 };
const tursoStatements: string[] = [];
const tursoFetch = (async (url: any, init: any) => {
  tursoHits.n++;
  for (const req of JSON.parse(init.body).requests ?? []) {
    tursoStatements.push(req.stmt?.sql ?? req.type);
  }
  return fetch(url, init);
}) as any;

const tursoVa = VaClient.create({
  driver: "http",
  dsn: server.url,
  http: { protocol: "turso", fetch: tursoFetch },
  schema: new SchemaParser().parse(SCHEMA),
  models: { user: { tableName: "users" }, post: { tableName: "posts" } },
});

tursoHits.n = 0;
tursoStatements.length = 0;
await tursoVa.transaction(async (tx) => {
  await tx.repository("user").create({ email: "tx@x.dev" });
});
console.log(
  `${"transaction (turso, session)".padEnd(38)} ${String(tursoHits.n).padStart(2)} hit  ${tursoStatements.join(" | ")}`,
);

await va.disconnect();
await tursoVa.disconnect();
await server.stop();

// ---- hit count ke DB REMOTE sungguhan ----
const { loadRemoteEnv, remoteEnvAvailable } =
  await import("./test/remote-env.js");
if (remoteEnvAvailable()) {
  const env = loadRemoteEnv();
  let remoteHits = 0;
  const remoteFetch = (async (url: any, init: any) => {
    remoteHits++;
    return fetch(url, init);
  }) as any;

  const remoteVa = VaClient.create({
    driver: "http",
    dsn: env.VA_HTTP_URL!,
    http: {
      protocol: "generic",
      dialect: "postgres",
      authToken: env.VA_HTTP_TOKEN!,
      headers: {
        "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID!,
        "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET!,
      },
      timeoutMs: 8_000,
      fetch: remoteFetch,
    },
    models: { job: { tableName: "scrape_jobs" } },
  });

  const rrepo = remoteVa.repository("job");
  const rows: string[] = [];

  const rm = async (label: string, fn: () => Promise<unknown>) => {
    remoteHits = 0;
    await fn();
    rows.push(`${label.padEnd(38)} ${String(remoteHits).padStart(2)} hit`);
  };

  await rm("remote findMany", () => rrepo.findMany({ limit: 5 }));
  await rm("remote count", () => rrepo.count());
  await rm("remote exists", () => rrepo.exists({ status: "queued" } as any));
  await rm("remote findUnique", async () => {
    const first = await rrepo.findFirst();
    if (first) await rrepo.findUnique({ id: first.id } as any);
  });

  console.log("\n--- DB remote (SQL gateway + Cloudflare Access) ---");
  console.log(rows.join("\n"));
  await remoteVa.disconnect();
}

process.exit(0);
