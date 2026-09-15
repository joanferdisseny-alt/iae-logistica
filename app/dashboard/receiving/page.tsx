import { requireAccess } from "@/lib/auth/context";
import type { InventoryTemplateDefinition, TemplateFieldType } from "@/lib/inventory/templates";
import { Receiving } from "./receiving";

export const dynamic="force-dynamic";
export default async function ReceivingPage() {
  const {supabase,isAdmin,profile,roleCode}=await requireAccess();
  type Option={id:string;name:string;headquarters_id:string};
  const sites:Option[]=[],locations:Option[]=[],containers:Option[]=[];
  for(const [table,target] of [["headquarters",sites],["locations",locations],["inventory_containers",containers]] as const) {
    for(let from=0;;from+=500) {
      const query=supabase.from(table).select(table==="headquarters"?"id, name":"id, name, headquarters_id").eq("is_active",true).order("name").order("id").range(from,from+499);
      if(!isAdmin) query.eq(table==="headquarters"?"id":"headquarters_id",profile.headquarters_id);
      const {data,error}=await query.returns<Option[]>();
      if(error||!data) return <p className="ec-error">No se pudieron cargar las sedes y destinos. Vuelve a cargar la página.</p>;
      target.push(...data);if(data.length<500)break;
    }
  }
  const templates:InventoryTemplateDefinition[]=[];
  const canCreate=["admin","editor","operator"].includes(roleCode);
  if(canCreate) for(let from=0;;from+=500) {
    const {data,error}=await supabase.from("inventory_templates")
      .select("id, code, name, description, category_code, inventory_template_fields(is_required, sort_order, inventory_fields(field_key, label, field_type, options))")
      .order("name").order("id").range(from,from+499)
      .returns<Array<{id:string;code:string;name:string;description:string|null;category_code:string;inventory_template_fields:Array<{is_required:boolean;sort_order:number;inventory_fields:{field_key:string;label:string;field_type:TemplateFieldType;options:string[]}|null}>}>>();
    if(error||!data) return <p className="ec-error">No se pudo cargar el catálogo de fichas. Vuelve a cargar la página.</p>;
    templates.push(...data.map(t=>({id:t.id,code:t.code,name:t.name,description:t.description??"",category:t.category_code,
      fields:t.inventory_template_fields.sort((a,b)=>a.sort_order-b.sort_order).flatMap(f=>f.inventory_fields?[{key:f.inventory_fields.field_key,label:f.inventory_fields.label,type:f.inventory_fields.field_type,options:f.inventory_fields.options,required:f.is_required}]:[])})));
    if(data.length<500)break;
  }
  return <Receiving sites={sites} locations={locations} containers={containers} templates={templates} isAdmin={isAdmin} canCreate={canCreate} initialSite={profile.headquarters_id??sites[0]?.id??""}/>;
}
