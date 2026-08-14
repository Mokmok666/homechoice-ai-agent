export interface PropertyPrice { listing: number; expected: number; ideal: string }
export interface ComparableTransaction { price: number; area: number; floor: string; date: string }
export interface PropertyCommute { drive: number; peakDrive: number; transit: number; transfers: number }
export interface PropertyEducation { school: string; status: "已核实" | "待确认" }
export interface PropertyManagement { company: string; fee: number; maintenance: string; serviceScore: number }
export interface DimensionScore { label: string; score: number; group: string }
export interface Property { id:string; name:string; city:string; district:string; area:number; layout:string; floor:string; image:string; price:PropertyPrice; completeness:number; score:number; decision:"BUY"|"WAIT"|"PASS"; tags:string[]; commute:PropertyCommute; education:PropertyEducation; management:PropertyManagement; dimensions:DimensionScore[] }
export interface BuyerPreference { purpose:string; budget:[number,number]; education:string; stages:string[]; workLocations:string[]; commuteMode:string; priorities:string[] }
export interface DecisionHistoryItem { id:string; date:string; time:string; title:string; count:number; recommendation:string; decision:string }
