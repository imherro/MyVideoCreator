import React, { useEffect, useRef, useState } from "react";

export function VoiceSamplePlayer({ url, name, autoPlay = false }: {
  url: string;
  name: string;
  autoPlay?: boolean;
}) {
  const player = useRef<HTMLAudioElement>(null);
  const attempted = useRef("");
  const [message, setMessage] = useState("");
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    setMessage("");
    const audio = player.current;
    if (!audio || !autoPlay || attempted.current === url) return;
    attempted.current = url;
    let active = true;
    void audio.play().catch(() => {
      if (active) setMessage("试听已就绪，点击播放即可收听。");
    });
    return () => { active = false; audio.pause(); };
  }, [url, autoPlay]);
  return <div className="voice-sample-player full">
    <span>{name}{duration > 0 && <small> · {duration.toFixed(1)} 秒</small>}</span>
    <audio ref={player} src={url} controls preload="metadata" aria-label={name}
      onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onPlay={() => setMessage("")} onError={() => setMessage("音频加载失败，请稍后重试。")}/>
    {message && <small role="status">{message}</small>}
  </div>;
}
