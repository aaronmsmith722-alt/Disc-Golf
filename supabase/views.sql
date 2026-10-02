-- Views the app reads from. Every stat is calculated from hole_scores and holes
-- at query time; no totals are stored (see Phase 2 writeup, Decision 2).
-- security_invoker makes each view respect the Row Level Security of its tables.

-- Layout metrics per course (Plan Your Bag)
create view public.course_layout_stats with (security_invoker = true) as
select c.course_id, c.course_name, c.city, c.holes_count, c.user_notes,
       count(h.hole_id)::int              as mapped_holes,
       sum(h.par)::int                    as total_par,
       sum(h.distance_feet)::int          as total_feet,
       round(avg(h.distance_feet))::int   as avg_feet,
       min(h.distance_feet)               as min_feet,
       max(h.distance_feet)               as max_feet
from public.courses c
left join public.holes h on h.course_id = c.course_id
group by c.course_id;

-- One row per round with its totals
create view public.round_summary with (security_invoker = true) as
select r.round_id, r.course_id, c.course_name, r.round_date, r.round_notes,
       (select count(*) from public.holes h2 where h2.course_id = r.course_id)::int as course_holes,
       count(hs.hole_score_id)::int          as holes_played,
       coalesce(sum(hs.strokes), 0)::int     as strokes,
       coalesce(sum(h.par), 0)::int          as par,
       coalesce(sum(hs.strokes - h.par), 0)::int as score_to_par
from public.rounds r
join public.courses c on c.course_id = r.course_id
left join public.hole_scores hs on hs.round_id = r.round_id
left join public.holes h on h.hole_id = hs.hole_id
group by r.round_id, c.course_name;

-- Every scored hole with its par (round scorecards)
create view public.score_details with (security_invoker = true) as
select hs.hole_score_id, hs.round_id, hs.course_id, r.round_date, h.hole_number, h.par,
       h.distance_feet, hs.strokes, hs.strokes - h.par as to_par
from public.hole_scores hs
join public.holes h on h.hole_id = hs.hole_id
join public.rounds r on r.round_id = hs.round_id;

-- Score-type counts per course (birdie / par / bogey rates)
create view public.scoring_rates with (security_invoker = true) as
select hs.course_id,
       count(*)::int                                          as holes_played,
       count(*) filter (where hs.strokes <= h.par - 2)::int  as eagles,
       count(*) filter (where hs.strokes =  h.par - 1)::int  as birdies,
       count(*) filter (where hs.strokes =  h.par)::int      as pars,
       count(*) filter (where hs.strokes =  h.par + 1)::int  as bogeys,
       count(*) filter (where hs.strokes >= h.par + 2)::int  as doubles
from public.hole_scores hs
join public.holes h on h.hole_id = hs.hole_id
group by hs.course_id;
