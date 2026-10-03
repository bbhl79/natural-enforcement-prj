import { useSelector } from "react-redux";
import type { RootState } from "./store";

export function App() {
  const ready = useSelector((state: RootState) => state.app.ready);
  return (
    <main className="min-h-screen bg-stone-100 p-6 text-lg text-stone-900">
      {ready ? "gzgt" : ""}
    </main>
  );
}
