export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type PropertyRow = {
  id: string;
  user_id: string;
  property_id: string;
  data: Json;
  created_at: string;
  updated_at: string;
};

type PreferencesRow = {
  id: string;
  user_id: string;
  data: Json;
  created_at: string;
  updated_at: string;
};

type HistoryRow = {
  id: string;
  user_id: string;
  history_id: string;
  data: Json;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      properties: {
        Row: PropertyRow;
        Insert: Omit<PropertyRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PropertyRow, "id">>;
        Relationships: [];
      };
      buyer_preferences: {
        Row: PreferencesRow;
        Insert: Omit<PreferencesRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PreferencesRow, "id">>;
        Relationships: [];
      };
      decision_history: {
        Row: HistoryRow;
        Insert: Omit<HistoryRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<HistoryRow, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
