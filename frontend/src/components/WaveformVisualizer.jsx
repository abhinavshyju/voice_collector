import { useRef, useEffect } from 'react';

/**
 * Real-time audio waveform visualizer using Web Audio AnalyserNode.
 * Pass an active MediaStream to start drawing.
 */
export default function WaveformVisualizer({ stream }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      const w = canvas.width = canvas.offsetWidth * 2;
      const h = canvas.height = canvas.offsetHeight * 2;
      ctx.clearRect(0, 0, w, h);
      analyser.getByteFrequencyData(dataArray);

      const barWidth = (w / bufferLength) * 1.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 255;
        const barHeight = v * h * 0.85;
        const gradient = ctx.createLinearGradient(0, h - barHeight, 0, h);
        gradient.addColorStop(0, `rgba(124, 92, 252, ${0.3 + v * 0.7})`);
        gradient.addColorStop(1, `rgba(0, 212, 170, ${0.2 + v * 0.5})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
      animRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      source.disconnect();
      audioCtx.close();
    };
  }, [stream]);

  return (
    <div className="waveform-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
