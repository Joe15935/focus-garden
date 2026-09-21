import { useState } from "react";
import { Download } from "lucide-react";
import { gardenCommand } from "./api";
import { GardenError } from "./common";
export function ExportActions() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<unknown>();
  async function exportFile(format: "json" | "csv") {
    setBusy(true);
    setError(null);
    try {
      const path = await gardenCommand<string | null>(`export_${format}`);
      if (path) setResult(`已保存到 ${path}`);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="garden-export">
      <div className="garden-inline-actions">
        <button
          className="garden-button secondary small"
          type="button"
          disabled={busy}
          onClick={() => exportFile("json")}
        >
          <Download size={14} /> 导出 JSON
        </button>
        <button
          className="garden-button secondary small"
          type="button"
          disabled={busy}
          onClick={() => exportFile("csv")}
        >
          导出 CSV
        </button>
      </div>
      {result && <p role="status">{result}</p>}
      <GardenError error={error} />
    </div>
  );
}
