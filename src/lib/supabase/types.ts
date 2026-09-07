// Hand-written to match supabase/migrations/*.sql. Regenerate with
// `supabase gen types typescript --linked` once the Supabase CLI is linked
// to the project, and replace this file.

export type Role = "operator" | "player" | "coach";
export type GameType =
  | "friendly"
  | "preseason"
  | "season"
  | "playoff"
  | "tournament"
  | "championship";
export type HomeAway = "home" | "away";
export type GameStatus = "setup" | "active" | "completed" | "cancelled";
export type InningHalf = "top" | "bottom";
export type AtBatResult =
  | "single"
  | "double"
  | "triple"
  | "hr"
  | "flyout"
  | "groundout"
  | "lineout"
  | "strikeout"
  | "walk"
  | "hbp"
  | "error"
  | "fc";
export type HitType = "groundball" | "linedrive" | "flyball" | "bunt" | "popup" | "hr";
export type PitchType = "fastball" | "curveball" | "changeup" | "slider" | "2seam" | "other";
export type PitchOutcome = "strike" | "ball" | "foul" | "hbp" | "inplay";

export interface Database {
  public: {
    Tables: {
      teams: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["teams"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          role: Role;
          team_id: string | null;
          player_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          role?: Role;
          team_id?: string | null;
          player_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          jersey_number: number | null;
          position: string | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          jersey_number?: number | null;
          position?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["players"]["Insert"]>;
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          team_id: string;
          season_id: string | null;
          opponent_id: string | null;
          opponent_name: string;
          game_date: string;
          game_time: string | null;
          game_type: GameType;
          home_away: HomeAway;
          our_score: number;
          opponent_score: number;
          status: GameStatus;
          umpire_name: string | null;
          winning_pitcher_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          season_id?: string | null;
          opponent_id?: string | null;
          opponent_name: string;
          game_date: string;
          game_time?: string | null;
          game_type: GameType;
          home_away: HomeAway;
          our_score?: number;
          opponent_score?: number;
          status?: GameStatus;
          umpire_name?: string | null;
          winning_pitcher_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["games"]["Insert"]>;
        Relationships: [];
      };
      lineup: {
        Row: {
          id: string;
          game_id: string;
          player_id: string;
          batting_order: number;
          position: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          player_id: string;
          batting_order: number;
          position?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["lineup"]["Insert"]>;
        Relationships: [];
      };
      at_bats: {
        Row: {
          id: string;
          game_id: string;
          player_id: string;
          pitcher_id: string | null;
          inning: number;
          inning_half: InningHalf;
          batting_order_position: number | null;
          result: AtBatResult;
          hit_type: HitType | null;
          field_x: number | null;
          field_y: number | null;
          rbi: number;
          runs_scored: number;
          is_out: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          player_id: string;
          pitcher_id?: string | null;
          inning: number;
          inning_half: InningHalf;
          batting_order_position?: number | null;
          result: AtBatResult;
          hit_type?: HitType | null;
          field_x?: number | null;
          field_y?: number | null;
          rbi?: number;
          runs_scored?: number;
          is_out?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["at_bats"]["Insert"]>;
        Relationships: [];
      };
      pitches: {
        Row: {
          id: string;
          at_bat_id: string;
          pitch_number: number;
          pitch_type: PitchType | null;
          zone_x: number | null;
          zone_y: number | null;
          outcome: PitchOutcome;
          created_at: string;
        };
        Insert: {
          id?: string;
          at_bat_id: string;
          pitch_number: number;
          pitch_type?: PitchType | null;
          zone_x?: number | null;
          zone_y?: number | null;
          outcome: PitchOutcome;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pitches"]["Insert"]>;
        Relationships: [];
      };
      seasons: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          year: number;
          start_date: string;
          end_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          year: number;
          start_date: string;
          end_date: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["seasons"]["Insert"]>;
        Relationships: [];
      };
      opponents: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["opponents"]["Insert"]>;
        Relationships: [];
      };
      opponent_players: {
        Row: {
          id: string;
          opponent_id: string;
          name: string;
          jersey_number: string;
          position: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          opponent_id: string;
          name: string;
          jersey_number?: string;
          position?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["opponent_players"]["Insert"]>;
        Relationships: [];
      };
      stolen_bases: {
        Row: {
          id: string;
          game_id: string;
          player_id: string;
          inning: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          player_id: string;
          inning: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["stolen_bases"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
