"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IDENTITY_EVENT, loadIdentity, type Identity } from "@/lib/identity";
import { Avatar } from "../Avatar";


/** Header link to your profile: your avatar once you've made one, "Me" before that. */
export function MeLink() {
  const [me, setMe] = useState<Identity | null>(null);
  useEffect(() => {
    queueMicrotask(() => setMe(loadIdentity()));
    const reread = () => setMe(loadIdentity());
    window.addEventListener(IDENTITY_EVENT, reread);
    return () => window.removeEventListener(IDENTITY_EVENT, reread);
  }, []);
  return (
    <Link href="/me" className="btn border-2 px-3 py-1.5" aria-label="Your profile" title="Your profile">
      {me ? (
        <>
          <Avatar id={me.avatar} />
          <span className="hidden max-w-24 truncate sm:inline" style={{ color: me.color }}>
            {me.name}
          </span>
        </>
      ) : (
        <span>Me</span>
      )}
    </Link>
  );
}
