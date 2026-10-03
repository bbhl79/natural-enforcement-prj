import type { MaterialType } from "../material/types";

export interface DossierIngest {
  dossierId: string;
  materialType: MaterialType;
  storageKey: string;
  contentHash: string;
}
