// Demo seed data + default rates/units. Ported from backend/app/api/routes.py.

export const DEFAULT_UNITS: Record<string, string> = {
  earthwork: "m3", concrete: "m3", formwork: "m2", rebar: "kg",
  steel: "kg", masonry: "m3", plaster: "m2",
};

export const DEMO_MEMBERS: Record<string, any>[] = [
  { member_type: "earthwork_pit", label: "E1", length_mm: 2000, breadth_mm: 2000,
    depth_mm: 1500, count: 4, working_offset_mm: 150, contains_labels: ["F1", "PCC1"] },
  { member_type: "pcc", label: "PCC1", length_mm: 2000, breadth_mm: 2000,
    thickness_mm: 100, count: 4 },
  { member_type: "footing", label: "F1", length_mm: 2000, breadth_mm: 2000,
    depth_mm: 400, count: 4, mesh_bottom_x: { dia_mm: 12, spacing_mm: 150 },
    mesh_bottom_y: { dia_mm: 12, spacing_mm: 150 } },
  { member_type: "column", label: "C1", b_mm: 300, D_mm: 600, height_mm: 3000,
    count: 4, main_bars: [{ dia_mm: 16, count: 8 }],
    ties: { dia_mm: 8, legs: 2, spacing_mm: 150 } },
  { member_type: "beam", label: "B1", b_mm: 230, depth_mm: 450, clear_span_mm: 4500,
    count: 6, top_bars: [{ dia_mm: 16, count: 2 }],
    bottom_bars: [{ dia_mm: 16, count: 3 }],
    stirrups: { dia_mm: 8, legs: 2, spacing_mm: 150 } },
  { member_type: "slab", label: "S1", length_mm: 4500, breadth_mm: 4000,
    thickness_mm: 125, count: 1, main_bars: { dia_mm: 10, spacing_mm: 150 },
    dist_bars: { dia_mm: 8, spacing_mm: 200 } },
  { member_type: "brick_wall", label: "W1", length_mm: 4500, height_mm: 3000,
    thickness_mm: 230, count: 4,
    openings: [{ width_mm: 1000, height_mm: 2100, count: 1 }],
    embedded_labels: ["C1"] },
  { member_type: "plaster_surface", label: "P1", length_mm: 4500, height_mm: 3000,
    faces: 2, thickness_mm: 12, count: 4,
    openings: [{ width_mm: 1000, height_mm: 2100, count: 1 }] },
  { member_type: "steel_member", label: "ST1", designation: "ISMB300",
    length_mm: 6000, count: 8 },
];

export const DEMO_RATES: Record<string, number> = {
  earthwork: 350, concrete: 6500, formwork: 450, rebar: 75,
  steel: 90, masonry: 6000, plaster: 280,
};
