// SPDX-License-Identifier: MPL-2.0
// 左下の一行。ページの中身には触らない(足すだけ)

export function Note(props: { text: string }) {
  return (
    <div
      style={{
        position: "fixed",
        left: "0.75rem",
        bottom: "0.6rem",
        font: "11px/1.4 system-ui, sans-serif",
        color: "#6a7180",
        opacity: 0.85,
        pointerEvents: "none",
        zIndex: 2147483647,
      }}
    >
      {props.text}
    </div>
  );
}
