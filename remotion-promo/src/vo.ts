import vo from "./vo.json";

export type VoLine = (typeof vo.lines)[number];

export const VO = vo.lines;

export const voLine = (id: string): VoLine => {
  const l = VO.find((x) => x.id === id);
  if (!l) throw new Error(`vo line ${id} missing — run pnpm vo`);
  return l;
};
