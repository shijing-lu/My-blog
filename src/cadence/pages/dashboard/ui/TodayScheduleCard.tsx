import { Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/cadence/data/db/database";
import { createScheduleDeps, setEventDone } from "@/cadence/features/schedule";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function TodayScheduleCard({ dateKey }: { dateKey: string }) {
  const events = useLiveQuery(
    () => db.scheduleEvents.where("dateKey").equals(dateKey).sortBy("startMin"),
    [dateKey],
  );

  return (
    <section className="surface-card cadence-overview-card" aria-label="今日时间安排">
      <div className="cadence-card-heading flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px]">今日时间安排</h3>
        <Link to="/schedule" className="text-xs text-primary">
          时间轴
        </Link>
      </div>
      <div className="cadence-card-scroll" tabIndex={0} role="region" aria-label="今日时间块">
      <ul className="space-y-2">
        {events?.map((event) => (
          <li
            key={event.id}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md bg-muted px-2 py-2"
          >
            <span className="numeric col-span-2 text-xs text-muted-foreground">
              {clock(event.startMin)}–{clock(event.endMin)}
            </span>
            <span
              className={`min-w-0 break-words text-sm ${event.done ? "line-through text-muted-foreground" : ""}`}
            >
              {event.title}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void setEventDone(
                  createScheduleDeps(db),
                  event.dateKey,
                  event.id,
                  !event.done,
                  Date.now(),
                ).catch((error) => toast.error(error.message))
              }
            >
              {event.done ? "重开" : "完成"}
            </Button>
          </li>
        ))}
      </ul>
      {events !== undefined && !events.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          今天还没有安排时间块。
        </p>
      )}
      </div>
    </section>
  );
}
