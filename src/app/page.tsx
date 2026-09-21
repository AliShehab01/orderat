"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoaded(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="prototype-shell">
      {!loaded && (
        <div className="prototype-loading" aria-live="polite">
          {/* The app icon is part of the locally bundled prototype. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/orderat/favicon.svg" alt="" />
          <strong>اوردرات</strong>
          <span>جاري تجهيز مساحة الطلبات…</span>
        </div>
      )}
      <iframe
        className={loaded ? "prototype-frame is-ready" : "prototype-frame"}
        src="/orderat/index.html"
        title="اوردرات — Orderat browser MVP"
        onLoad={() => setLoaded(true)}
        allow="microphone"
      />
    </main>
  );
}
