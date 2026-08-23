import type { BuyerPreference, DecisionHistoryItem, DimensionScore, Property } from "./types";
const groups=["区位与家庭生活","房屋与居住体验","价格与购买安全边际","长期价值"];
const labels=["地段成熟度","通勤便利度","公共交通便利度","商业生活配套","教育 / 学区匹配度","医疗及基础生活配套","户型设计","空间匹配度","房龄 / 楼龄","小区品质","物业服务评价","总价预算匹配度","真实成交价合理度","流动性","保值潜力"];
const scores=[9,8.6,8.8,8.5,7.4,8.2,8.5,8.7,7.2,8,8.3,7.5,7.6,8.1,8.4];
const dimensions:DimensionScore[]=labels.map((label,i)=>({label,score:scores[i],group:groups[i<6?0:i<11?1:i<13?2:3]}));
export const properties:Property[]=[
 {id:"baoli",name:"珠江新城·保利天悦",city:"广州",district:"天河区",area:89,layout:"3室2厅",floor:"高层",image:"https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85",price:{listing:228,expected:220,ideal:"218–222 万"},completeness:78,score:84,decision:"WAIT",tags:["地段成熟","通勤均衡","物业稳定"],commute:{drive:32,peakDrive:48,transit:41,transfers:1},education:{school:"实验小学",status:"待确认"},management:{company:"保利物业",fee:4.8,maintenance:"良好",serviceScore:8.3},dimensions},
 {id:"vanke",name:"万科城市之光",city:"广州",district:"黄埔区",area:95,layout:"3室2厅",floor:"中高层",image:"https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=85",price:{listing:215,expected:208,ideal:"202–208 万"},completeness:85,score:76,decision:"WAIT",tags:["社区新","户型实用"],commute:{drive:45,peakDrive:62,transit:53,transfers:2},education:{school:"科学城小学",status:"已核实"},management:{company:"万科物业",fee:4.2,maintenance:"优秀",serviceScore:8.8},dimensions:dimensions.map(x=>({...x,score:Math.max(6.3,x.score-.7)}))},
 {id:"xinghui",name:"越秀·星汇云锦",city:"广州",district:"海珠区",area:92,layout:"3室2厅",floor:"中层",image:"https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=85",price:{listing:205,expected:198,ideal:"194–199 万"},completeness:68,score:73,decision:"PASS",tags:["环境舒适","配套成熟"],commute:{drive:39,peakDrive:55,transit:46,transfers:1},education:{school:"海珠实验小学",status:"待确认"},management:{company:"越秀服务",fee:3.9,maintenance:"良好",serviceScore:7.9},dimensions:dimensions.map(x=>({...x,score:Math.max(6,x.score-1)}))},
 {id:"zhonghai",name:"中海·观澜府",city:"广州",district:"番禺区",area:88,layout:"3室2厅",floor:"中层",image:"https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85",price:{listing:202,expected:196,ideal:"190–196 万"},completeness:79,score:68,decision:"PASS",tags:["总价友好","景观开阔"],commute:{drive:55,peakDrive:75,transit:67,transfers:2},education:{school:"区属小学",status:"待确认"},management:{company:"中海物业",fee:3.6,maintenance:"良好",serviceScore:8.1},dimensions:dimensions.map(x=>({...x,score:Math.max(5.2,x.score-1.5)}))}
];
export const preference:BuyerPreference={purpose:"自住",budget:[190,230],education:"未来可能需要",stages:["小学"],workLocations:["珠江新城","琶洲"],commuteMode:"两者都可以",priorities:["通勤","小区环境","总价"]};
export const history:DecisionHistoryItem[]=[
 {id:"h1",date:"2026-08-10",time:"10:30",title:"广州改善型自住对比",count:4,recommendation:"珠江新城·保利天悦",decision:"WAIT"},
 {id:"h2",date:"2026-08-05",time:"15:45",title:"通勤优先方案",count:3,recommendation:"科学城·越秀星汇文玺",decision:"WAIT"},
 {id:"h3",date:"2026-07-28",time:"09:20",title:"保值导向方案",count:4,recommendation:"琶洲·保利世贸中心",decision:"BUY"},
 {id:"h4",date:"2026-07-16",time:"14:10",title:"预算控制方案",count:3,recommendation:"番禺万博·越秀和樾府",decision:"WAIT"}
];
