// 内业核查执行端口（#213）：本期唯一新增的业务端口。
//
// 外业空间套合／分析与图层服务调用都封装在这个端口之后：
// 编排侧只拿「每层的事实」，不直接碰图层服务。端口必须可注入——测试用注入替身，
// 部署环境供真实图层服务地址时用默认实现。
//
// 端口不暴露任何图层服务客户端类型：出参只有事实（相交要素标识、相交多边形几何、面积）。

/** 注入令牌。 */
export const CLUE_VERIFICATION_PORT = Symbol('CLUE_VERIFICATION_PORT');

/** 线索的一个几何部件（EPSG:4490 GeoJSON 文本）。 */
export interface VerificationPart {
  readonly partId: string;
  readonly partIndex: number;
  /** EPSG:4490 的 GeoJSON 文本。 */
  readonly geojson: string;
}

/** 一次核查的入参：线索的几何与图斑总面积。 */
export interface VerificationRequest {
  readonly clueId: string;
  readonly domain: string;
  /** 空间对象版本：分析时刻几何的内容摘要（内容寻址版本号）。 */
  readonly spatialVersion: string;
  /** 图斑总面积（平方米）。 */
  readonly totalArea: number;
  readonly parts: readonly VerificationPart[];
}

/** 一个相交要素的事实。 */
export interface VerificationFeature {
  /** 要素标识（图层服务给的）。 */
  readonly featureId: string;
  /** 相交要素本身的几何（GeoJSON 文本，EPSG:4490）。 */
  readonly geometry: string;
  /** 相交多边形的几何（GeoJSON 文本，EPSG:4490）。 */
  readonly intersection: string;
  /** 该要素图斑的总面积（平方米）。 */
  readonly featureArea: number;
  /** 该要素与线索图斑的相交面积（平方米）。 */
  readonly overlapArea: number;
}

/** 一层的核查事实。 */
export interface VerificationLayerResult {
  readonly layerKey: string;
  readonly layerName: string;
  /** 三态：overlapped（有相交）｜no_overlap（无相交）｜unavailable（查不成）。 */
  readonly state: 'overlapped' | 'no_overlap' | 'unavailable';
  /** 该层的服务地址（不含任何密钥）。未配置即 null。 */
  readonly serviceUrl: string | null;
  /** 查询时间（ISO）。未查询即 null。 */
  readonly queriedAt: string | null;
  /** 查不成的原因词（连字符小写）：service-not-configured｜service-unavailable｜timeout｜invalid-response。 */
  readonly unavailableReason: string | null;
  /** 全部相交要素。 */
  readonly features: readonly VerificationFeature[];
}

/** 一次核查的结果：逐层事实。 */
export interface VerificationOutcome {
  readonly layers: readonly VerificationLayerResult[];
}

/**
 * 内业核查执行端口。
 * 实现方负责：向各图层服务远程查询、做空间套合、算相交事实。
 */
export interface ClueVerificationPort {
  run(request: VerificationRequest): Promise<VerificationOutcome>;
}
