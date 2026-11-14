# 业务决策登记

本文件登记没有法规出处的业务决策。代码里 `basis` 写 `业务决策:DEC-<序号>` 时，编号必须在本文件内。可选字段 `expected` 登记消费方机器形态（规则键、天数、代码集合等），供反向校验测试读取；它不是法规断言，不替代判据项。

业务决策的 `expected` 只描述代码登记值是否与委托方清单一致，不得据此类推广州办理要求或文书要素。

判据资格口径：委托方内部文件（如市局清单、程序条）属单源，只能作「委托方作业依据」，不得冒充法规判据，不得产出广州办理要求、文书格式、卷宗要素或期限断言。

```json decisions
{
  "decisions": [
    {
      "id": "DEC-001",
      "subject": "法审期限 5＋10 个工作日",
      "consumer": "backend/deadline/src/rules.ts#legal-review.round",
      "source": "广州市局程序条参照适用清单（#241/6431445240）",
      "reason": "无公开法规给出该数值。清单把它列为本地程序要求，属委托方作业依据，单源。",
      "risk": "市局程序条修订时须同步代码；无法规判据可自动校验。",
      "expected": {
        "ruleKey": "legal-review.round",
        "dayCount": 5,
        "dayBasis": "working",
        "extensionAllowance": 10
      }
    },
    {
      "id": "DEC-002",
      "subject": "移送告知 3 个工作日",
      "consumer": "backend/deadline/src/rules.ts#transfer.notice",
      "source": "代码既有值，出处待查证",
      "reason": "仓库内未查到法规或委托方文件给出该数值。首批按裁量层登记，不冒充法规判据。",
      "risk": "数值可能不符合广州实际要求。查证到出处后须改为判据项或补登出处。",
      "expected": { "ruleKey": "transfer.notice", "dayCount": 3, "dayBasis": "working" }
    },
    {
      "id": "DEC-003",
      "subject": "必审清单第 5 项列举的处罚种类",
      "consumer": "backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_PENALTY_CODES",
      "source": "广州市局 2022-02-15 必审清单第 5 项",
      "reason": "委托方内部文件，单源。条例与法律只给法制审核情形，不给具体罚种清单。",
      "risk": "清单修订时须同步；不得据本项产出法规断言。",
      "expected": {
        "penaltyCodes": [
          "confiscate-mineral-products",
          "confiscate-illegal-gains",
          "confiscate-illegal-buildings",
          "demolish-illegal-buildings",
          "revoke-exploration-permit",
          "revoke-mining-permit",
          "revoke-geological-disaster-qualification",
          "revoke-surveying-qualification"
        ]
      }
    },
    {
      "id": "DEC-004",
      "subject": "涉刑移送自动触发法制审核",
      "consumer": "backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_ITEMS",
      "source": "广州市局 2022-02-15 必审清单",
      "reason": "行政处罚法第五十八条与广州市依法行政条例第三十七条均未单列涉刑移送。它是清单六项之一，属委托方作业依据。",
      "risk": "清单修订时须同步；不得据本项产出法规断言。",
      "expected": { "reviewCode": "criminal-transfer" }
    }
  ]
}
```