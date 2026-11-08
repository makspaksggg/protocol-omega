# PROTOCOL OMEGA

Co-op horror for up to 6 players in the browser. You are lifers in hazmat suits sent into crippled
underground facilities: collect the quota, recover the documents, assemble the core access code,
trigger self-destruct, and escape before it blows.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000, create a room and share the 4-letter code with friends.
Voice chat needs microphone permission (works on `localhost` or over HTTPS).

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Shift | Sprint |
| C / Ctrl | Crouch |
| Space | Jump |
| F | Flashlight |
| M | Mute mic |
| V | Push to talk (when enabled in settings) |
| T | Text chat |
| Esc | Menu / settings |

## Tech

- **Client:** Three.js, PS1-style renderer (low-res target, vertex snapping, dithering), procedural textures and models.
- **Server:** Node.js + `ws`: rooms by code, 20 Hz state snapshots, WebRTC signaling relay.
- **Voice:** WebRTC mesh + Web Audio HRTF panning; volume falls off with distance and walls muffle it.

## Roadmap

1. ✅ Foundation: rooms, 6 players, first-person movement, proximity voice chat
2. Procedural facility generation
3. Quota: valuables, carrying (two-person heavy items), fragility, drop-off point
4. Objectives: documents, core code fragments, core terminal
5. Threats: aliens (hunt by sound), mutated scientists, security robots, environmental hazards
6. Self-destruct escape sequence
7. Shop and progression between shifts
8. Polish and deployment
