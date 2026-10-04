import { lazy, Suspense, useEffect, useState } from "react";
import { bootstrapAtStartup } from "./data/db/bootstrap";
import { db } from "./data/db/database";
import { purgeExpiredTrash } from "./data/repo/soft-delete";
import "./styles/blog.css";
const App = lazy(() =>
  import("./app/App").then((module) => ({ default: module.App })),
);

export default function CadenceRoot() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void bootstrapAtStartup(Date.now())
      .then(() => purgeExpiredTrash(db, Date.now()))
      .then(
        () => {
          if (mounted) setReady(true);
        },
        () => {
          if (mounted)
            setError("本地存储无法打开。请检查浏览器存储权限后重试。");
        },
      );
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <div className="cadence-root">
      {error ? (
        <div role="alert" className="mx-auto max-w-6xl px-4 py-10">
          {error}
          <button className="ml-3 underline" onClick={() => location.reload()}>
            重试
          </button>
        </div>
      ) : ready ? (
        <Suspense
          fallback={
            <p
              role="status"
              className="mx-auto max-w-6xl px-4 py-10 text-muted-foreground"
            >
              正在加载日程界面…
            </p>
          }
        >
          <App />
        </Suspense>
      ) : (
        <p
          role="status"
          className="mx-auto max-w-6xl px-4 py-10 text-muted-foreground"
        >
          正在打开本地日程…
        </p>
      )}
    </div>
  );
}
