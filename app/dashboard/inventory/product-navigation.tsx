"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { legacyProductSection, productSectionHref, productSections, type ProductSection } from "@/lib/inventory/product-sections";
import { Icon } from "../icons";

export function ProductNavigation({ itemId, section, hasSizes }: { itemId: string; section: ProductSection; hasSizes: boolean }) {
  const router = useRouter();
  useEffect(() => {
    // Old bookmarks and QR links keep their destination after splitting the detail page.
    const target = legacyProductSection(window.location.hash);
    if (target && !new URLSearchParams(window.location.search).has("section")) {
      const page = Number(new URLSearchParams(window.location.search).get("historyPage"));
      router.replace(productSectionHref(itemId, target, Number.isSafeInteger(page) ? page : undefined), { scroll: false });
    }
  }, [itemId, router]);
  return <nav className="ec-product-tabs" aria-label="Secciones de la ficha">
    {productSections.filter(tab => tab.id !== "sizes" || hasSizes).map(tab => <Link key={tab.id}
      href={productSectionHref(itemId, tab.id)} prefetch={false} aria-current={section === tab.id ? "page" : undefined}>
      <Icon name={tab.icon} />{tab.label}
    </Link>)}
  </nav>;
}
