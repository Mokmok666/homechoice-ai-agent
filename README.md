# HomeChoice — AI 房产决策助手

帮助用户比较 3–5 套已入围房源的 AI 产品经理作品集 Demo。

## Locked stack

- Next.js App Router + TypeScript
- Tailwind CSS
- shadcn/ui foundation
- Lucide Icons
- Future backend: Next.js Route Handlers, Supabase, Zhipu GLM, Vercel

当前为 **Phase 1 — Static UI + Mock Data**。不得在没有明确指示的情况下更换技术栈或引入额外框架。

## Phase 0.5 — Product Foundation

产品基础与工程规范已经建立：

- Product requirement documentation
- User flow definition
- Data model planning
- Engineering rules

相关文档位于 [`docs/`](./docs/)：

- [`PRODUCT_REQUIREMENTS.md`](./docs/PRODUCT_REQUIREMENTS.md)
- [`USER_FLOW.md`](./docs/USER_FLOW.md)
- [`DATA_MODEL.md`](./docs/DATA_MODEL.md)
- [`PROJECT_RULES.md`](./docs/PROJECT_RULES.md)

未来所有 Codex 或其他 AI Coding Agent 在修改项目代码前，都必须阅读并遵守 `docs/PROJECT_RULES.md`。

## Run

```bash
npm install
npm run dev
npm run build
```

Phase 1 不包含真实数据库、认证、上传、地图、评分引擎或 AI API 调用。
