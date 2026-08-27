import type { Metadata } from "next"; import "./globals.css"; import { Header } from "@/components/layout/header"; import { SupabaseAuthProvider } from "@/components/providers/supabase-auth-provider";
export const metadata:Metadata={title:"HomeChoice｜AI 房产决策助手",description:"帮助家庭比较 3–5 套候选房源，做出更清晰、更可解释的购房决策。"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><SupabaseAuthProvider><Header/>{children}</SupabaseAuthProvider></body></html>}
