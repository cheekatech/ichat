export default function Splash({ text = 'Loading iChat' }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}
