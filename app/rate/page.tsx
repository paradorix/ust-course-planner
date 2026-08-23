import { Suspense } from "react";
import type { Metadata } from "next";
import RateView from "./RateView";

export const metadata: Metadata = {
  title: "Rate my timetable — UST Course Planner",
};

/**
 * RateView reads useSearchParams(), which requires a Suspense boundary
 * around it or a production build fails outright (see Next's
 * "Missing Suspense boundary with useSearchParams" build error). The
 * fallback is only ever visible for an instant during the client-side
 * bailout this causes — there's no meaningful loading state to design here.
 */
export default function RatePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <RateView />
    </Suspense>
  );
}
