// 核查图层目录（#213；规格 C 节「初始 8 类图层」，ADR 0021「外部空间图层以服务地址接入」）。
//
// 八类图层：街道镇边界供辖区建议用（#214），其余七类供土地与矿产线索的内业核查。
// 全部按空间服务地址接入，核查时向服务远程实时查询，本地不落图层副本。
// 服务地址是运行参数（ADR 0008 轨道），由部署环境供给；地址不含密钥。
//
// 不虚构矿权图层：矿产线索查的就是这七类。

/** 一类核查图层。 */
export interface VerificationLayer {
  /** 图层键（写进核查报告与运行行，界面据此显示）。 */
  readonly key: string;
  /** 中文图层名。 */
  readonly name: string;
  /** 运行参数名：该图层空间服务的地址取自这个环境变量。 */
  readonly envName: string;
}

/** 七类核查图层：土地与矿产线索的内业核查图层。 */
export const VERIFICATION_LAYERS: readonly VerificationLayer[] = [
  { key: 'permanent-farmland', name: '永久基本农田', envName: 'NE_LAYER_URL_PERMANENT_FARMLAND' },
  { key: 'ecological-redline', name: '生态保护红线', envName: 'NE_LAYER_URL_ECOLOGICAL_REDLINE' },
  { key: 'urban-development-boundary', name: '城镇开发边界', envName: 'NE_LAYER_URL_URBAN_DEVELOPMENT_BOUNDARY' },
  { key: 'cultivated-land', name: '耕地', envName: 'NE_LAYER_URL_CULTIVATED_LAND' },
  { key: 'land-conversion-approval', name: '农用地转用审批', envName: 'NE_LAYER_URL_LAND_CONVERSION_APPROVAL' },
  { key: 'construction-land-permit', name: '建设用地规划许可', envName: 'NE_LAYER_URL_CONSTRUCTION_LAND_PERMIT' },
  { key: 'land-supply-redline', name: '供地红线', envName: 'NE_LAYER_URL_LAND_SUPPLY_REDLINE' },
] as const;

/** 街道镇边界：供辖区建议用（#214），不参与土地与矿产核查。 */
export const STREET_BOUNDARY_LAYER: VerificationLayer = {
  key: 'street-boundary',
  name: '街道镇边界',
  envName: 'NE_LAYER_URL_STREET_BOUNDARY',
};

/** 全部八类图层（核查七类加街道镇边界）。 */
export const ALL_LAYERS: readonly VerificationLayer[] = [...VERIFICATION_LAYERS, STREET_BOUNDARY_LAYER];

/** 按键取图层。取不到即 null（名册外的键不认）。 */
export function findVerificationLayer(key: string): VerificationLayer | null {
  return ALL_LAYERS.find((layer) => layer.key === key) ?? null;
}
