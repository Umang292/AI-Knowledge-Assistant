# Quill — AI document workspace

Quill is a full-stack document Q&A app built with Next.js, TypeScript, PostgreSQL/pgvector, and the OpenAI API. It includes password-based accounts, private PDF libraries, semantic retrieval, streamed answers with source references, and saved conversations.

## Run locally

Requirements: Node.js 22+, Docker, and an OpenAI API key.

1. Copy `.env.example` to `.env` and set `SESSION_SECRET` to a random secret of at least 32 characters and `OPENAI_API_KEY` to your key.
2. Start PostgreSQL with the pgvector extension:

   ```sh
   docker compose up -d db
   ```

3. Install and start the app:

   ```sh
   npm install
   npm run dev
   ```

4. Open http://localhost:3000 and create an account. Upload a PDF, start a conversation, and ask questions about its contents.

To run the app and database together in Docker, use `docker compose up --build`. The compose app service requires `SESSION_SECRET` and `OPENAI_API_KEY` in the shell environment; a `.env` file can provide them.

## API

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`; `GET /api/auth/me`
- `GET` and `POST /api/documents`; `DELETE /api/documents?id=...`
- `GET` and `POST /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/chat` — server-sent events (`sources`, `delta`, `done`, or `error`)

PDF files are parsed in memory and only extracted text chunks and embeddings are persisted. Extracted text is sent to the configured OpenAI API for embeddings and question answering. Every library, conversation, and retrieval query is scoped to the authenticated account. The first database request creates the pgvector extension and application tables.

## Production notes

Use a managed PostgreSQL instance with pgvector, HTTPS, a strong unique session secret, and an OpenAI project key with appropriate spend limits. Add rate limiting, email verification, password reset, malware scanning, and an object-storage retention policy before opening account creation to the public. The included PDF size limit is 20 MiB.
