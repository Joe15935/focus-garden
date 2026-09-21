import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Plant } from "./art";

describe("plant accessible labels", () => {
  it("describes cosmetic thumbnails as previews without claiming earned time", () => {
    render(<Plant minutes={90} preview />);
    expect(screen.getByRole("img", { name: "装扮预览" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /已专注/ })).not.toBeInTheDocument();
  });

  it("continues to describe real plants using credited minutes", () => {
    render(<Plant minutes={1} />);
    expect(screen.getByRole("img", { name: "种子，已专注 1 分钟" })).toBeInTheDocument();
  });
});
