const iceServers = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const turn = import.meta.env.VITE_TURN_URL;
if (turn) {
  iceServers.push({
    urls: turn.split(',').map((s) => s.trim()).filter(Boolean),
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
}

export const rtcConfig = { iceServers };
