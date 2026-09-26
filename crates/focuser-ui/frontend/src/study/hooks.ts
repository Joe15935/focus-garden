import { useMutation, useQueryClient } from "@tanstack/react-query";
import { STUDY_KEY, studyCommand } from "./api";
import * as C from "./core";
import { newId, type StudyDoc, type StudyEvent, type StudySnapshot, validateDoc } from "./model";

/** Saves a whole settings document against the revision it was edited from. */
export function useSaveDoc(snapshot: StudySnapshot) {
  const query = useQueryClient();
  return useMutation({
    mutationFn: async (doc: StudyDoc) => {
      const errors = validateDoc(doc);
      if (errors.length) throw new Error(errors.join("；"));
      return studyCommand<{ revision: number }>("save_doc", {
        expected_revision: snapshot.revision,
        doc,
      });
    },
    onSettled: () => query.invalidateQueries({ queryKey: STUDY_KEY }),
  });
}

export function useAppendEvent() {
  const query = useQueryClient();
  return useMutation({
    mutationFn: (event: StudyEvent) => studyCommand("append_event", { event }),
    onSettled: () => query.invalidateQueries({ queryKey: STUDY_KEY }),
  });
}

export function makeEvent(
  patch: Omit<StudyEvent, "id" | "self_reported"> & { id?: string },
): StudyEvent {
  const minutes = Math.max(0, Math.min(600, Math.round(patch.minutes)));
  C.parseDate(patch.date);
  return { id: patch.id ?? newId(), self_reported: true, ...patch, minutes };
}

export async function saveText(
  content: string,
  fileName: string,
  extension: "json" | "ics" | "csv",
) {
  return studyCommand<string | null>("save_text", {
    content,
    file_name: fileName,
    extension,
  });
}
export async function pickText(kind: "json" | "csv" | "ics") {
  return studyCommand<string | null>("pick_file", { kind });
}

export function weekdayName(n: number): string {
  return ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][n] ?? "";
}
export function mondayOf(date: string): string {
  return C.addDays(date, 1 - C.weekday(date));
}
