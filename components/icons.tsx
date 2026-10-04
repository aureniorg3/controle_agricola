import type { ReactNode } from "react";

/**
 * Conjunto de ícones do sistema — desenhados numa grade de 24 px, traço de
 * 1,75 px com pontas arredondadas, herdando a cor do texto (`currentColor`).
 * Foco no setor sucroenergético: cana, colhedora, caminhão canavieiro,
 * balança de pesagem, talhões, usina.
 */
export interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/* ---------------------------- módulos do sistema ---------------------------- */

export function IconPainel(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="8.5" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
      <rect x="3.5" y="15" width="7" height="5.5" rx="1.6" />
    </Svg>
  );
}

export function IconAcompanhamentos(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4v16h16" />
      <path d="M8 15l3.5-4 3 2.5L19 8" />
      <path d="M16 8h3v3" />
    </Svg>
  );
}

export function IconCana(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 21V11" />
      <path d="M12 21V7.5" />
      <path d="M17.5 21V11" />
      <path d="M5 17.5h3" />
      <path d="M10.5 17.5h3" />
      <path d="M16 17.5h3" />
      <path d="M5 14h3" />
      <path d="M10.5 13.5h3" />
      <path d="M16 14h3" />
      <path d="M12 7.5C11 5 8.5 3.5 5 3.6c.3 2.8 2.9 4.2 7 3.9Z" />
      <path d="M12 7.5C13 5 15.5 3.5 19 3.6c-.3 2.8-2.9 4.2-7 3.9Z" />
    </Svg>
  );
}

export function IconOrdemCorte(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5" />
      <path d="M8.5 10h7" />
      <path d="M8.5 13.5h7" />
      <path d="M8.5 17h4" />
    </Svg>
  );
}

export function IconOrdemEncerrada(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5" />
      <path d="M8.8 14.2l2.2 2.2 4.2-4.6" />
    </Svg>
  );
}

export function IconMeta(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11.5" cy="12.5" r="8" />
      <circle cx="11.5" cy="12.5" r="4.2" />
      <circle cx="11.5" cy="12.5" r="0.9" fill="currentColor" />
      <path d="M11.5 12.5L19 5" />
      <path d="M16.5 4.5h3v3" />
    </Svg>
  );
}

export function IconHistorico(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v3.5h3.5" />
      <path d="M12 8v4l2.8 1.8" />
    </Svg>
  );
}

export function IconBalanca(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4v16" />
      <path d="M7 20h10" />
      <path d="M5 7h14" />
      <path d="M5 7l-2.5 6a3 3 0 0 0 5 0L5 7Z" />
      <path d="M19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z" />
    </Svg>
  );
}

export function IconColhedora(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="14" cy="18" r="2.2" />
      <path d="M4 15.8V11a1 1 0 0 1 1-1h8.5a1 1 0 0 1 .9.55L16 14v1.8" />
      <path d="M6 10V6.5a1 1 0 0 1 1-1h3a1 1 0 0 1 .9.6L12.5 10" />
      <path d="M14.3 10.5L20 5.5" />
      <path d="M18.4 4.5l2.8 2" />
      <path d="M16 16.2h4.5l1 1.8" />
    </Svg>
  );
}

export function IconInsumo(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3h8l-1.2 3.2c2.4 1.6 3.7 4.2 3.7 7.3 0 4-2.6 7.5-6.5 7.5S5.5 17.5 5.5 13.5c0-3.1 1.3-5.7 3.7-7.3L8 3Z" />
      <path d="M9.2 6.2h5.6" />
      <path d="M12 17.5c0-3 1.6-4.8 3.5-5-.1 2.2-1.4 4.6-3.5 5Z" />
    </Svg>
  );
}

export function IconOrdemServico(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4.5 16.5a1.4 1.4 0 0 0 2 2l4.8-4.8a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-.6-.6-2 2.4-2.3Z" />
    </Svg>
  );
}

export function IconCaminhaoCana(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 17V9.5a1 1 0 0 1 1-1H14V17" />
      <path d="M14 11h3.6a1 1 0 0 1 .8.4l2.1 2.8a1 1 0 0 1 .2.6V17h-1" />
      <path d="M14 17h-2.5" />
      <path d="M5.5 17H4" />
      <circle cx="8" cy="17.5" r="2" />
      <circle cx="17.5" cy="17.5" r="2" />
      <path d="M4.5 8l1.6-3.5M7.7 8l1.6-3.5M10.9 8l1.6-3.5" />
    </Svg>
  );
}

export function IconAlerta(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
    </Svg>
  );
}

export function IconAtividades(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 6h10.5M9.5 12h10.5M9.5 18h10.5" />
      <path d="M3.8 6l1.2 1.2L7 5M3.8 12l1.2 1.2L7 11M3.8 18l1.2 1.2L7 17" />
    </Svg>
  );
}

export function IconMapa(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.5L9 4l6 2.5 5.5-2.5v13L15 19.5 9 17l-5.5 2.5v-13Z" />
      <path d="M9 4v13M15 6.5v13" />
    </Svg>
  );
}

export function IconRodadas(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="M9 4.5V3.5h6v1M8.5 11l1.8 1.8L13.5 9.5M8.5 16.5h7" />
    </Svg>
  );
}

export function IconTalhao(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M3.5 15h17" />
      <path d="M9.2 4.5v15M14.8 4.5v15" />
    </Svg>
  );
}

export function IconEquipe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8.5" r="2.8" />
      <path d="M3.5 20c0-3.3 2.5-5.8 5.5-5.8s5.5 2.5 5.5 5.8" />
      <circle cx="17" cy="9.5" r="2.2" />
      <path d="M15.8 14.4c2.6.3 4.7 2.4 4.7 5.1" />
    </Svg>
  );
}

export function IconConfig(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.8-1.4-2-3.4-2.1.7a7.6 7.6 0 0 0-2.6-1.5L14.1 2.5h-4l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.1-.7-2 3.4L4.6 10.5a7.7 7.7 0 0 0 0 3L2.8 15l2 3.4 2.1-.7c.76.66 1.64 1.17 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.1.7 2-3.4-1.8-1.5Z" />
    </Svg>
  );
}

export function IconUsina(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 21V11l6 3.5V11l6 3.5V4.5h5V21" />
      <path d="M3 21h18" />
      <path d="M7.5 18v-2M12 18v-2M17.5 18v-4" />
    </Svg>
  );
}

/* --------------------------------- indicadores --------------------------------- */

export function IconTch(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
      <path d="M12 14l3.2-4.2" />
      <circle cx="12" cy="14.3" r="1.3" />
      <path d="M6.6 9.6l1.3 1M12 5.8v1.6M17.4 9.6l-1.3 1" />
      <path d="M7 17.5h10" />
    </Svg>
  );
}

export function IconRelogio(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/* --------------------------------- interface --------------------------------- */

export function IconBusca(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}

export function IconSetaDireita(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconSetaEsquerda(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconSetaBaixo(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function IconSair(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}

export function IconMenu(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconImprimir(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 9V3.5h10V9" />
      <path d="M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2" />
      <rect x="7" y="14" width="10" height="6.5" rx="1" />
    </Svg>
  );
}

export function IconImportar(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 15.5V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function IconMais(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconFechar(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconOlho(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconOlhoOculto(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.5 5.2A10.4 10.4 0 0 1 12 5c6.2 0 10 7 10 7a17 17 0 0 1-3.1 3.9" />
      <path d="M6.6 6.6C4 8.3 2 12 2 12s3.8 7 10 7a9.7 9.7 0 0 0 3.6-.7" />
    </Svg>
  );
}
