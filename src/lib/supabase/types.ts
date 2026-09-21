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
  | "fc"
  | "double_play"
  | "intentional_walk"
  // Fix 2 (baseball-logic-fixes batch): a strikeout the catcher dropped,
  // where the batter reached first safely (1st was open, or 2 outs --
  // see isForced/dropped-third-strike eligibility in operator-console.tsx).
  // A caught third strike, or a dropped one the batter is thrown out on,
  // both stay a plain "strikeout" -- this value only exists for the
  // "batter safe" branch.
  | "dropped_third_strike_safe"
  // Fix 9 (baseball-logic-fixes batch, minor tier): automatic, no operator
  // judgment on runner advancement -- distinct from a regular "double" so
  // it's never confused with one in the box score.
  | "ground_rule_double";
export type HitType = "groundball" | "linedrive" | "flyball" | "bunt" | "popup" | "hr";
export type PitchType = "fastball" | "curveball" | "changeup" | "slider" | "2seam" | "other";
// Fix 3 (baseball-logic-fixes batch): "foul_tip" is a caught foul tip --
// counts as a strike including strike 3 (ends the at-bat as a strikeout),
// unlike a regular "foul" which can never complete strike 3. Always
// caught by definition (if it weren't caught, it would just be a "foul"),
// so it never triggers the Fix 2 dropped-third-strike prompt.
export type PitchOutcome = "strike" | "ball" | "foul" | "foul_tip" | "hbp" | "inplay";
export type AtBatMode = "hitting" | "pitching";
export type SubReason = "tactical" | "injury" | "ejection" | "defensive" | "pinch_hit" | "pinch_run";
export type GameEventType =
  | "wild_pitch"
  | "passed_ball"
  | "balk"
  | "error"
  | "pickoff_out"
  | "pickoff_attempt"
  | "tag_up_violation"
  | "intentional_walk"
  | "stolen_base"
  | "caught_stealing"
  | "rundown_out"
  | "runner_passed"
  | "out_at_next_base"
  | "squeeze_play"
  | "dropped_third_strike";
export type OutType = "force" | "tag";
export type FieldingPosition = "P" | "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF";
export type BattingHand = "L" | "R" | "S";
export type ThrowingHand = "L" | "R";
// "positions" (calibrate-field-tabs batch) shares the same
// field_calibration table/unique(team_id, field_type) constraint as
// "2d"/"3d" -- a third row per team, no schema change needed since the
// column is already jsonb and the shape it holds is tab-specific anyway.
export type FieldType = "2d" | "3d" | "positions";

// Field calibration tool, tabs 1-2: 7 anchor points mapping a field
// image's pixel space (as a 0-100 percentage of the image's own width/
// height) onto the same 0-100 scale at_bats.field_x/field_y already
// uses. Key names match the calibration tool's own point order exactly.
export interface FieldCalibrationPoints {
  home_plate: { x: number; y: number };
  first_base: { x: number; y: number };
  second_base: { x: number; y: number };
  third_base: { x: number; y: number };
  lf_wall: { x: number; y: number };
  cf_wall: { x: number; y: number };
  rf_wall: { x: number; y: number };
}

// Field calibration tool, tab 3 ("Player Positions"): where each
// defensive position's avatar snaps to in the visual lineup builder,
// placed by hand rather than computed from the 7 anchors above -- this
// is what standardPositionLocations' formula-based guesses are meant to
// be replaced by once a team has calibrated it. DH is optional (a team
// without a marked DH spot still gets the labeled-drop-zone fallback in
// the lineup builder), so every key here is optional -- unlike
// FieldCalibrationPoints, where all 7 are required before Save appears.
export interface PlayerPositionCalibration {
  P?: { x: number; y: number };
  C?: { x: number; y: number };
  "1B"?: { x: number; y: number };
  "2B"?: { x: number; y: number };
  "3B"?: { x: number; y: number };
  SS?: { x: number; y: number };
  LF?: { x: number; y: number };
  CF?: { x: number; y: number };
  RF?: { x: number; y: number };
  DH?: { x: number; y: number };
}

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
          batting_hand: BattingHand | null;
          throwing_hand: ThrowingHand | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          jersey_number?: number | null;
          position?: string | null;
          user_id?: string | null;
          batting_hand?: BattingHand | null;
          throwing_hand?: ThrowingHand | null;
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
          out_type: OutType | null;
          fielded_by_position: FieldingPosition | null;
          fielded_by_player_id: string | null;
          fielded_by_opponent_player_id: string | null;
          // Feature 1 (fielding-play logging batch): standard scorebook
          // notation ("6-4-3 DP", "5-3", "F8", "L7", "E5"), computed
          // client-side and stored once per play on the batter's row.
          scorebook_notation: string | null;
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
          out_type?: OutType | null;
          fielded_by_position?: FieldingPosition | null;
          fielded_by_player_id?: string | null;
          fielded_by_opponent_player_id?: string | null;
          scorebook_notation?: string | null;
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
          swing: boolean | null;
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
          swing?: boolean | null;
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
          player_id: string | null;
          opponent_player_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          inning: number;
          inning_half: InningHalf;
          event_type: GameEventType;
          note?: string | null;
          player_id?: string | null;
          opponent_player_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["game_events"]["Insert"]>;
        Relationships: [];
      };
      field_calibration: {
        Row: {
          id: string;
          team_id: string | null;
          field_type: FieldType | null;
          // Shape depends on field_type: FieldCalibrationPoints for
          // "2d"/"3d", PlayerPositionCalibration for "positions" -- the
          // same jsonb column holds either, so callers narrow by which
          // field_type they queried for.
          calibration_points: FieldCalibrationPoints | PlayerPositionCalibration | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id?: string | null;
          field_type?: FieldType | null;
          calibration_points?: FieldCalibrationPoints | PlayerPositionCalibration | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["field_calibration"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
