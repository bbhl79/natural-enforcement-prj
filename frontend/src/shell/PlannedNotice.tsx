// 规划中占位的提示（案件中心、统筹督导、系统管理下的占位项）。
// 文案只说业务范围，不写工程符号、不写票号。
export default function PlannedNotice({ label, hint }: { label: string; hint?: string }) {
  return (
    <>
      <div className="page-h">
        <div>
          <h1>
            {label}
            <span className="tag gray">规划中</span>
          </h1>
          <div className="desc">本模块尚未开放真实业务办理，后续范围接入后在此办理。</div>
        </div>
      </div>
      <div className="card">
        <div className="banner gray" style={{ margin: 0 }}>
          {`「${label}」当前标记为规划中。`}
          {hint ? ` ${hint}` : ''}
          {' 综合查询入口常显于顶栏右侧，任何人可用。'}
        </div>
      </div>
    </>
  );
}
