// A starter block in Tribe notation, so the program builder isn't empty on day one.
import { W1_LINE } from "./schedule.js";

const id = () => crypto.randomUUID().slice(0, 8);
const ex = (name, sets, reps, target, cue = "", rest = "", note = "") => ({ id: id(), name, sets, reps, target, cue, rest, note });
const pct = (w) => `${70 + 2.5 * w}-${75 + 2.5 * w}% of 1RM`;
const REST = "Rest 3-4 minutes between sets";
// Block letters in order: the main lift on its own, then accessories paired as a superset.
const blocks = (exs, letters) => exs.map((e, i) => ({ ...e, block: letters[i] }));

export function exampleProgram() {
  const weeks = [0, 1, 2].map((w) => {
    const rpe = w === 0 ? W1_LINE : "Increase load by 2.5-5kg from last week.";
    const reps = w === 0 ? W1_LINE : "Same load as last week. 2-3 more reps.";
    const main = w === 0 ? W1_LINE : "";
    return {
      days: [
        { id: id(), name: "Tribe Build", dow: 1, coachNote: w === 0 ? "RPE is how hard a set felt out of 10. A 7 means you had about 3 good reps left. This week is calibration, so be honest with the numbers you log." : "", exercises: blocks([
          ex("Back Squat", 4, "5", pct(w), "", REST, main),
          ex("Single Arm Dumbbell Row", 3, "10.10", "7 RPE", "single arm", "", rpe),
          ex("Bulgarian Split Squat", 3, "8.8", "7 RPE", "each leg", "", rpe),
          ex("Back Extension + Hold", 3, "8.30", "7 RPE", "8 reps then 30 sec hold", "", reps),
        ], ["A", "B", "B", "C"]) },
        { id: id(), name: "Hypertrophy X", dow: 3, coachNote: "", exercises: blocks([
          ex("Barbell Bench Press", 4, "5", pct(w), "", REST, main),
          ex("Chest Supported Row", 3, "10", "7 RPE", "", "", rpe),
          ex("Incline Dumbbell Press", 3, "10", "7 RPE", "", "", rpe),
          ex("Face Pull", 3, "15", "7 RPE", "use rope, pull it apart throughout", "Rest 60-90 seconds", reps),
        ], ["A", "B", "B", "C"]) },
        { id: id(), name: "TribeFit", dow: 5, coachNote: "", exercises: blocks([
          ex("Squat Clean + Split Jerk", 8, "1.2", "7 RPE", "1 squat clean + 2 split jerks", "", rpe),
          ex("Deadlift", 4, "5", pct(w), "", REST, main),
          ex("Weighted Side Bend + Suitcase Carry", 3, "12.45", "7 RPE", "12 reps then 45 sec carry", "", rpe),
        ], ["A", "B", "C"]) },
      ],
    };
  });
  return { name: "Tribe Build Block 1 (example)", note: "3 week strength block. Week 1 calibrates on RPE, the main lifts run on percentages.", weeks };
}
