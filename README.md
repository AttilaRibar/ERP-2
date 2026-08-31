This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

## Supabase

The whole backend runs on Supabase: Postgres (through Drizzle ORM), Supabase
Auth for sign-in and RBAC, and Supabase Storage for uploaded budget files.
There is no AWS dependency any more.

Add these to `.env.local`:

```bash
# Postgres (Supabase → Project Settings → Database → Connection string)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<host>:6543/postgres

# Supabase project (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

NEXT_PUBLIC_APP_URL=http://localhost:3000

# Subcontractor settle portal session signing key
SETTLE_JWT_SECRET=<random 32+ char string>
```

The legacy key names `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are still accepted. Never expose the secret
(service-role) key with a `NEXT_PUBLIC_` prefix — it bypasses RLS.

### Authentication

Sign-in is e-mail + password through Supabase Auth:

- `/login` posts to the `loginAction` Server Action, which calls
  `supabase.auth.signInWithPassword()`. `@supabase/ssr` stores the session in
  httpOnly `sb-*` cookies.
- `proxy.ts` runs before every request, verifies the access token with
  `supabase.auth.getClaims()` (locally against the project JWKS when asymmetric
  signing keys are enabled), refreshes it when needed, and forwards the user
  context to Server Components and Server Actions as `x-user-*` headers.
- `/api/auth/callback` exchanges a PKCE `code` for a session, so magic links,
  invitations, password recovery and OAuth providers work. Register
  `${NEXT_PUBLIC_APP_URL}/api/auth/callback` under **Authentication → URL
  Configuration → Redirect URLs** in the Supabase dashboard.
- Logging out calls `supabase.auth.signOut()`, which clears the cookies.

Create users in the Supabase dashboard (**Authentication → Users**) or with the
secret key via `supabase.auth.admin`.

### Roles and permissions

RBAC roles live in the user's `app_metadata`, so they travel inside the access
token. The available roles are `erp-admin`, `erp-manager`, `erp-accountant` and
`erp-viewer` — the permission map is in `lib/auth/permissions.ts`.

```sql
UPDATE auth.users
   SET raw_app_meta_data =
         COALESCE(raw_app_meta_data, '{}'::jsonb)
         || '{"erp_roles": ["erp-admin"]}'::jsonb
 WHERE email = 'user@example.com';
```

The user has to sign in again for a role change to take effect. In development,
a signed-in user with no roles is treated as `erp-admin`.

### Storage

Uploaded budget and import source files go to the `budget-files` bucket via the
Supabase Storage API (`lib/supabase/storage.ts`). Create the bucket as
**private** — downloads are handed out as 60-second signed URLs.

### Database migrations

SQL files live in `db/migrations/`, with a matching runner in `scripts/`:

```bash
DATABASE_URL=... node scripts/migrate-018.mjs
```

## AI Provider

The ERP assistant uses LangChain with OpenRouter's OpenAI-compatible API.
Configure the server-side environment with:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=ERP2

LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=ERP2-local
```

Do not expose the OpenRouter or LangSmith keys with a `NEXT_PUBLIC_` prefix.

## Excel MCP Server

The ERP chat agent edits uploaded `.xlsx` workbooks through
[`haris-musa/excel-mcp-server`](https://github.com/haris-musa/excel-mcp-server),
not through in-process ExcelJS mutation. The Next.js app connects to that server
with LangChain's `@langchain/mcp-adapters` package. The default integration uses
MCP stdio, so the Next.js server starts the Excel MCP process on demand.

1. Install `uv` on the machine running Next.js. On Windows, use:

	```powershell
	winget install Astral.UV
	```

2. Verify the MCP server can start:

	```powershell
	uvx excel-mcp-server stdio
	```

	Stop it after the first successful start. In normal local development the
	app starts it through LangChain's MCP adapter.

3. Add these optional values to `.env.local` if you want to be explicit:

	```bash
	EXCEL_MCP_COMMAND=uvx
	EXCEL_MCP_ARGS=["excel-mcp-server","stdio"]
	EXCEL_MCP_FILES_DIR=.tmp/agent-excel
	EXCEL_MCP_TIMEOUT_MS=60000
	```

For a separately running MCP process, use streamable HTTP instead:

```powershell
$env:EXCEL_FILES_PATH="D:\PROG\ERP2\.tmp\agent-excel"
$env:FASTMCP_PORT="8017"
uvx excel-mcp-server streamable-http
```

Then configure the Next.js app to use the same file directory:

```bash
EXCEL_MCP_URL=http://localhost:8017/mcp
EXCEL_MCP_FILES_DIR=D:\PROG\ERP2\.tmp\agent-excel
EXCEL_MCP_TIMEOUT_MS=60000
```

With HTTP transport, `EXCEL_MCP_FILES_DIR` must point to the same directory as
the MCP server's `EXCEL_FILES_PATH`, because the MCP server only accepts file
paths relative to that directory.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
