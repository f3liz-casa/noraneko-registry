// SPDX-License-Identifier: MPL-2.0

export function Hello(props: { name: string }) {
  return (
    <div style={{ position: "fixed", left: "0.75rem", bottom: "0.6rem", font: "11px/1.4 system-ui, sans-serif", opacity: 0.85 }}>
      hello from drop {props.name}
    </div>
  );
}
