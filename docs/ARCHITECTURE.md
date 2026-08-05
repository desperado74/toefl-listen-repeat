# Architecture

## Runtime

The application is deployed as a single Docker service:

1. Vite builds the React and TypeScript frontend.
2. FastAPI serves the compiled frontend and REST endpoints.
3. SQLite stores practice attempts and normalized evaluation results.
4. Audio files are stored outside the source tree on a persistent volume.
5. Azure Speech provides pronunciation assessment and transcription.
6. DeepSeek provides structured interview feedback and reference answers.

## Data Flow

### Listen & Repeat

1. The client loads an original practice prompt.
2. The browser records a learner response.
3. The backend submits the audio to Azure Speech.
4. Raw provider output and normalized diagnostics are persisted separately.
5. Historical results contribute to weak-word, phoneme and review queues.

### Speaking Interview

1. The learner records one answer for each of four progressive questions.
2. Azure Speech transcribes the recording.
3. DeepSeek returns structured training feedback and a reference answer.
4. The application stores the attempt and exposes it for later review.

### Adaptive Reading Simulation

1. The learner completes the routing module.
2. Local routing logic selects an Upper or Lower second module.
3. The application combines both modules into one result and skill review.

The routing and reported scores are training simulations, not official ETS algorithms or scores.

## Trust Boundaries

- Provider credentials remain in server-side environment variables.
- Browser clients receive only short-lived Azure tokens where required.
- Password-gated sessions and secure cookies are supported as an optional deployment mode; the public portfolio demo currently allows direct access.
- Local and hosted databases are intentionally separate.
- `.env`, SQLite files, recordings, generated audio and logs are excluded from Git.

## Scaling Notes

The current architecture favors a compact, reproducible portfolio deployment. A larger multi-user product should replace the shared password with user accounts, move persistence to a managed database and object storage, and add per-user quotas, request throttling and background jobs.
