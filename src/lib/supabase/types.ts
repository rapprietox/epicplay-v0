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
export type AtBatMode = "hitting" | "pitching";
export type SubReason = "tactical" | "injury" | "ejection" | "defensive" | "pinch_hit" | "pinch_run";
export type GameEventType = "wild_pitch" | "passed_ball" | "balk" | "error";

export interface RunnerState {
  type: "player" | "opponent";
  id: string | null;
  name: string;
  jersey?: string | null;
}
export interface Runners {
  first?: RunnerState | null;
  second?: RunnerState | null;
  third?: RunnerState | null;
}

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
          logging_accuracy_score: number | null;
          notes: string | null;
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
          logging_accuracy_score?: number | null;
          notes?: string | null;
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
          player_id: string | null;
          pitcher_id: string | null;
          mode: AtBatMode;
          inning: number;
          inning_half: InningHalf;
          batting_order_position: number | null;
          result: AtBatResult | null;
          hit_type: HitType | null;
          field_x: number | null;
          field_y: number | null;
          rbi: number;
          runs_scored: number;
          is_out: boolean;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          player_id?: string | null;
          pitcher_id?: string | null;
          mode?: AtBatMode;
          inning: number;
          inning_half: InningHalf;
          batting_order_position?: number | null;
          result?: AtBatResult | null;
          hit_type?: HitType | null;
          field_x?: number | null;
          field_y?: number | null;
          rbi?: number;
          runs_scored?: number;
          is_out?: boolean;
          confirmed_at?: string | null;
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
      game_state: {
        Row: {
          id: string;
          game_id: string;
          inning: number;
          inning_half: InningHalf;
          outs: number;
          mode: AtBatMode;
          batting_order_position: number | null;
          current_at_bat_id: string | null;
          current_pitcher_id: string | null;
          opponent_batter_name: string | null;
          runners: Runners;
          pitch_count_for_current_pitcher: number;
          pitch_count_ack_75: boolean;
          pitch_count_ack_85: boolean;
          pitch_count_ack_100: boolean;
          consecutive_low_accuracy_at_bats: number;
          logging_accuracy_score: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          inning?: number;
          inning_half?: InningHalf;
          outs?: number;
          mode?: AtBatMode;
          batting_order_position?: number | null;
          current_at_bat_id?: string | null;
          current_pitcher_id?: string | null;
          opponent_batter_name?: string | null;
          runners?: Runners;
          pitch_count_for_current_pitcher?: number;
          pitch_count_ack_75?: boolean;
          pitch_count_ack_85?: boolean;
          pitch_count_ack_100?: boolean;
          consecutive_low_accuracy_at_bats?: number;
          logging_accuracy_score?: number | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["game_state"]["Insert"]>;
        Relationships: [];
      };
      substitutions: {
        Row: {
          id: string;
          game_id: string;
          player_out_id: string;
          player_in_id: string;
          reason: SubReason;
          inning: number;
          inning_half: InningHalf;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          player_out_id: string;
          player_in_id: string;
          reason: SubReason;
          inning: number;
          inning_half: InningHalf;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["substitutions"]["Insert"]>;
        Relationships: [];
      };
      game_events: {
        Row: {
          id: string;
          game_id: string;
          inning: number;
          inning_half: InningHalf;
          event_type: GameEventType;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          inning: number;
          inning_half: InningHalf;
          event_type: GameEventType;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["game_events"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
