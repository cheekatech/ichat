import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { rtcConfig } from '../lib/rtc';
import { fmtDuration } from '../lib/utils';
import Avatar from './Avatar';

function mediaErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'iChat needs permission to use your microphone and camera. Allow access in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone or camera was found on this device.';
    case 'NotReadableError':
      return 'Your microphone or camera is in use by another app. Close it and try again.';
    default:
      return 'Could not start your microphone or camera. Calls need a secure (https) connection.';
  }
}

function Tile({ stream, name, profile, local, showVideo, pip, trouble }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== (stream || null)) el.srcObject = stream || null;
  }, [stream]);

  return (
    <div className={`tile ${pip ? 'pip' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={Boolean(local)} className={local ? 'mirror' : ''} />
      {!showVideo && (
        <div className="tile-cover">
          <Avatar profile={profile} label={name} size={pip ? 44 : 88} />
        </div>
      )}
      <span className="tile-name">
        {name}
        {local ? ' (you)' : ''}
        {trouble ? ', connection lost' : ''}
      </span>
    </div>
  );
}

export default function CallRoom({ call, me, members, onLeave }) {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState({}); // id -> { name, stream, state }
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(call.kind !== 'video');
  const [status, setStatus] = useState('starting'); // starting | waiting | live | error
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const R = useRef(null);
  const membersRef = useRef(members);
  membersRef.current = members;
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    const r = {
      pcs: new Map(),
      pending: new Map(),
      channel: null,
      stream: null,
      everConnected: false,
      startedAt: null,
      closed: false,
      leaving: false,
      cancelled: false,
      noAnswerTimer: null,
      chain: Promise.resolve(),
    };
    R.current = r;

    const send = (payload) => {
      try {
        return r.channel?.send({ type: 'broadcast', event: 'signal', payload });
      } catch {
        return null;
      }
    };
    const nameOf = (id, fallback) =>
      membersRef.current.find((m) => m.id === id)?.display_name || fallback || 'Participant';

    const teardown = () => {
      if (r.closed) return;
      r.closed = true;
      clearTimeout(r.noAnswerTimer);
      const ch = r.channel;
      if (ch) {
        Promise.resolve(send({ type: 'bye', from: me.id }))
          .catch(() => {})
          .then(() => supabase.removeChannel(ch));
      }
      r.pcs.forEach((pc) => {
        try { pc.close(); } catch { /* already closed */ }
      });
      r.pcs.clear();
      r.pending.clear();
      r.stream?.getTracks().forEach((t) => t.stop());
    };

    r.leave = (extra = {}) => {
      if (r.leaving) return;
      r.leaving = true;
      const alone = r.pcs.size === 0 || Boolean(extra.forceAlone);
      const duration = r.startedAt ? Math.round((Date.now() - r.startedAt) / 1000) : 0;
      teardown();
      onLeaveRef.current({ alone, connectedOnce: r.everConnected, duration, declined: Boolean(extra.declined) });
    };

    const removePeer = (id) => {
      const pc = r.pcs.get(id);
      if (pc) {
        try { pc.close(); } catch { /* already closed */ }
      }
      r.pcs.delete(id);
      r.pending.delete(id);
      setPeers((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      if (r.everConnected && r.pcs.size === 0 && !r.leaving) r.leave();
    };

    const createPeer = (id, name) => {
      const pc = new RTCPeerConnection(rtcConfig);
      r.pcs.set(id, pc);
      r.stream.getTracks().forEach((t) => pc.addTrack(t, r.stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'ice', from: me.id, to: id, candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        setPeers((p) => ({ ...p, [id]: { ...(p[id] || {}), name, stream } }));
      };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        setPeers((p) => (p[id] ? { ...p, [id]: { ...p[id], state: st } } : p));
        if (st === 'connected') {
          if (!r.everConnected) {
            r.everConnected = true;
            r.startedAt = Date.now();
            clearTimeout(r.noAnswerTimer);
          }
          setStatus('live');
        }
      };
      setPeers((p) => ({ ...p, [id]: { name, state: 'connecting' } }));
      return pc;
    };

    const makeOffer = async (id, pc) => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'offer', from: me.id, to: id, name: me.display_name, sdp: { type: offer.type, sdp: offer.sdp } });
    };

    const flush = async (id, pc) => {
      const queued = r.pending.get(id) || [];
      r.pending.delete(id);
      for (const c of queued) {
        try { await pc.addIceCandidate(c); } catch { /* stale candidate */ }
      }
    };

    // Rule: the participant with the smaller id sends the offer, so two people
    // joining at the same moment never send offers at each other (no glare).
    const handle = async (msg) => {
      if (!msg || msg.from === me.id || r.closed) return;
      if (msg.to && msg.to !== me.id) return;
      const id = msg.from;
      switch (msg.type) {
        case 'hello': {
          const nm = nameOf(id, msg.name);
          if (!msg.to) {
            // A greeting to everyone: drop any stale connection and greet back directly.
            const old = r.pcs.get(id);
            if (old) {
              try { old.close(); } catch { /* already closed */ }
              r.pcs.delete(id);
              r.pending.delete(id);
            }
            send({ type: 'hello', from: me.id, to: id, name: me.display_name });
          } else if (r.pcs.has(id)) {
            break;
          }
          const pc = r.pcs.get(id) || createPeer(id, nm);
          if (me.id < id) await makeOffer(id, pc);
          break;
        }
        case 'offer': {
          let pc = r.pcs.get(id);
          if (pc && pc.signalingState !== 'stable') {
            if (me.id < id) break;
            await pc.setLocalDescription({ type: 'rollback' });
          }
          if (!pc) pc = createPeer(id, nameOf(id, msg.name));
          await pc.setRemoteDescription(msg.sdp);
          await flush(id, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: 'answer', from: me.id, to: id, sdp: { type: answer.type, sdp: answer.sdp } });
          break;
        }
        case 'answer': {
          const pc = r.pcs.get(id);
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(msg.sdp);
            await flush(id, pc);
          }
          break;
        }
        case 'ice': {
          const pc = r.pcs.get(id);
          if (pc && pc.remoteDescription) {
            try { await pc.addIceCandidate(msg.candidate); } catch { /* stale candidate */ }
          } else {
            const q = r.pending.get(id) || [];
            q.push(msg.candidate);
            r.pending.set(id, q);
          }
          break;
        }
        case 'bye':
          removePeer(id);
          break;
        case 'decline':
          if (call.direct && !r.everConnected) r.leave({ declined: true, forceAlone: true });
          break;
        default:
      }
    };

    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: call.kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
        });
      } catch (e) {
        if (!r.cancelled) {
          setError(mediaErrorMessage(e));
          setStatus('error');
        }
        return;
      }
      if (r.cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      r.stream = stream;
      setLocalStream(stream);
      setStatus('waiting');

      const ch = supabase.channel(`call:${call.chatId}:${call.callId}`, {
        config: { private: true, broadcast: { self: false } },
      });
      r.channel = ch;
      ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
        r.chain = r.chain.then(() => handle(payload)).catch((e) => console.error('call signal error', e));
      });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          send({ type: 'hello', from: me.id, name: me.display_name });
        } else if ((s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') && !r.closed) {
          setError('Could not connect to the call room. Check your connection and try again.');
          setStatus('error');
        }
      });
      r.noAnswerTimer = setTimeout(() => {
        if (!r.everConnected && !r.leaving) r.leave();
      }, 60_000);
    })();

    return () => {
      r.cancelled = true;
      teardown();
    };
    // The call room is created once per call (keyed by callId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'live') return;
    const id = setInterval(() => {
      const s = R.current?.startedAt;
      if (s) setElapsed(Math.round((Date.now() - s) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const toggleMic = () => {
    const next = !muted;
    R.current?.stream?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };
  const toggleCam = () => {
    const next = !camOff;
    R.current?.stream?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCamOff(next);
  };

  const ids = Object.keys(peers);
  const profileOf = (id) => members.find((m) => m.id === id);
  const onePeer = ids.length <= 1;
  const statusText =
    status === 'error'
      ? ''
      : ids.length === 0
      ? call.caller ? 'Ringing…' : 'Joining…'
      : status === 'live'
      ? fmtDuration(elapsed)
      : 'Connecting…';

  return (
    <div className="call" role="dialog" aria-modal="true" aria-label={`${call.kind} call with ${call.title}`}>
      <header className="call-head">
        <strong>{call.title}</strong>
        <span aria-live="polite">{statusText}</span>
      </header>

      {status === 'error' ? (
        <div className="call-error">
          <p>{error}</p>
          <button className="btn primary" onClick={() => R.current?.leave()}>Close</button>
        </div>
      ) : (
        <div className={`call-stage ${onePeer ? 'one' : 'grid'}`}>
          {ids.length === 0 && (
            <div className="call-wait">
              <Avatar profile={null} label={call.title} size={96} />
              <p>{call.caller ? `Waiting for ${call.direct ? call.title : 'others'} to join` : 'Connecting you to the call'}</p>
            </div>
          )}
          {ids.map((id) => {
            const p = peers[id];
            const hasVideo = call.kind === 'video' && Boolean(p.stream) && p.stream.getVideoTracks().length > 0;
            return (
              <Tile
                key={id}
                stream={p.stream}
                name={p.name || profileOf(id)?.display_name || 'Participant'}
                profile={profileOf(id)}
                showVideo={hasVideo}
                trouble={p.state === 'failed' || p.state === 'disconnected'}
              />
            );
          })}
          {(call.kind === 'video' || ids.length > 1) && (
            <Tile
              local
              pip={onePeer}
              stream={localStream}
              name={me.display_name}
              profile={me}
              showVideo={call.kind === 'video' && !camOff}
            />
          )}
        </div>
      )}

      <footer className="call-controls">
        <button className={`round ${muted ? 'off' : ''}`} onClick={toggleMic} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} disabled={status === 'error'}>
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        {call.kind === 'video' && (
          <button className={`round ${camOff ? 'off' : ''}`} onClick={toggleCam} aria-pressed={camOff} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} disabled={status === 'error'}>
            {camOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        )}
        <button className="round danger" onClick={() => R.current?.leave()} aria-label="Leave call">
          <PhoneOff size={22} />
        </button>
      </footer>
    </div>
  );
}
