# Probe

Probe is an AI-powered GitHub PR Intelligence Agent that turns pull requests into team briefings.

## Milestone 1

This repo currently includes:

- Express server bootstrap
- `GET /health`
- `GET /dashboard`
- in-memory run store
- webhook route scaffold

## Local run

1. Copy `.env.example` to `.env`
2. Install dependencies with `npm install`
3. Start the server with `npm run dev`

## Next milestones

- webhook signature verification
- GitHub PR diff fetching
- OpenAI analysis
- reviewer suggestions
- PR comment posting
