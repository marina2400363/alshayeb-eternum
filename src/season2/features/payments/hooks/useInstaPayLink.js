import { useEffect, useRef, useState } from "react";
import { fetchInstaPayLink } from "../../../services/payments.api";

// Reads the real, admin-configured InstaPay destination from the shared
// public settings endpoint (see payments.api.js's fetchInstaPayLink — it
// treats the backend's own unconfigured placeholder as null). Not owned by
// any customer identity — no attendeeId/phone needed, this is the same
// platform-level settings document Season 1's legacy frontend already reads.
//   status: "loading" | "ready" | "error"
//   link: string | null   — null means "not configured yet", not a fetch error
export default function useInstaPayLink() {
  const [status, setStatus] = useState("loading");
  const [link, setLink] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchInstaPayLink({ signal: controller.signal })
      .then((result) => {
        if (!mounted.current) return;
        setLink(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (failure.kind === "aborted" || !mounted.current) return;
        // A fetch failure here still resolves to "no real link to show" —
        // the InstaPay panel's unavailable state covers both cases the same
        // way, so no retry affordance is needed for this non-critical read.
        setLink(null);
        setStatus("ready");
      });

    return () => controller.abort();
  }, []);

  return { status, link };
}
