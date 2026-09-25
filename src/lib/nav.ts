import { withBase } from "./base-path";

export interface SiteNavLink {
  href: string;
  label: string;
  external?: boolean;
  icon?: "github";
}

export const siteNavLinks: SiteNavLink[] = [
  { href: withBase("/"), label: "Explorar" },
  { href: withBase("/release"), label: "Release" },
  { href: withBase("/notas"), label: "Notas" },
  { href: withBase("/dados"), label: "Dados" },
  {
    href: "https://github.com/causa-mortis-brasil",
    label: "Projeto original",
    external: true,
    icon: "github",
  },
];
