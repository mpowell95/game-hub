// golf/courses/harbor/course.js - course 1, nine holes as JS objects. See §9 of GOLF-HANDOFF.md.
// Coordinates are metres in each hole's own frame (tee at origin, +z toward the hole).

export default {
  id: 'harbor',
  name: { en: 'Harbor Links', es: 'Harbor Links' },
  par: 36,
  holes: [
    // H1  Par 4  ~360 yd  gentle dogleg right, water left of the landing zone
    { n: 1, par: 4, seed: 101, tee: [0, 0], pin: [8, 330], target: [2, 215],
      fairway: { path: [[0, 20], [0, 150], [6, 260], [8, 315]], width: 34 },
      green: { center: [8, 330], radius: 13, tilt: [0, -0.01] }, fringe: 3,
      bunkers: [{ center: [-14, 318], radius: 6 }, { center: [22, 300], radius: 5 }],
      water: [{ poly: [[-60, 60], [-30, 60], [-30, 130], [-60, 130]] }],
      hills: [{ at: [40, 200], height: 4, radius: 45 }, { at: [-45, 260], height: 3, radius: 40 }],
      trees: { count: 60 }, intro: { from: [8, 40, 360], to: [0, 18, -25] } },

    // H2  Par 3  ~165 yd  over water to a wide green
    { n: 2, par: 3, seed: 102, tee: [0, 0], pin: [0, 151], target: [0, 151],
      fairway: { path: [[0, 110], [0, 140]], width: 26 },
      green: { center: [0, 151], radius: 15, tilt: [0.005, 0] }, fringe: 3,
      bunkers: [{ center: [18, 150], radius: 6 }],
      water: [{ poly: [[-40, 20], [40, 20], [40, 100], [-40, 100]] }],
      hills: [{ at: [0, 190], height: 5, radius: 35 }],
      trees: { count: 40 }, intro: { from: [0, 35, 185], to: [0, 15, -20] } },

    // H3  Par 5  ~520 yd  straight, long, bunkers guard the second landing area
    { n: 3, par: 5, seed: 103, tee: [0, 0], pin: [-6, 475], target: [-4, 320],
      fairway: { path: [[0, 20], [0, 240], [-4, 380], [-6, 455]], width: 36 },
      green: { center: [-6, 475], radius: 14, tilt: [0, -0.012] }, fringe: 3,
      bunkers: [{ center: [22, 330], radius: 7 }, { center: [-26, 350], radius: 7 }, { center: [-22, 470], radius: 5 }],
      water: [],
      hills: [{ at: [50, 150], height: 3, radius: 50 }, { at: [-55, 420], height: 4, radius: 45 }],
      trees: { count: 80 }, intro: { from: [-6, 45, 510], to: [0, 20, -30] } },

    // H4  Par 4  ~400 yd  dogleg left around a hill, blind-ish second shot
    { n: 4, par: 4, seed: 104, tee: [0, 0], pin: [-70, 340], target: [-38, 280],
      fairway: { path: [[0, 20], [-4, 160], [-30, 270], [-66, 325]], width: 32 },
      green: { center: [-70, 340], radius: 12, tilt: [-0.008, 0] }, fringe: 3,
      bunkers: [{ center: [-52, 335], radius: 6 }, { center: [-88, 352], radius: 5 }],
      water: [],
      hills: [{ at: [-70, 220], height: 7, radius: 45 }, { at: [40, 300], height: 3, radius: 50 }],
      trees: { count: 70 }, intro: { from: [-70, 40, 375], to: [0, 18, -25] } },

    // H5  Par 3  ~140 yd  elevated tee down to a small green ringed by sand
    { n: 5, par: 3, seed: 105, tee: [0, 0], pin: [4, 128], target: [0, 120],
      fairway: { path: [[0, 80], [3, 110]], width: 24 },
      green: { center: [4, 128], radius: 11, tilt: [0, 0.008] }, fringe: 3,
      bunkers: [{ center: [-10, 128], radius: 6 }, { center: [18, 128], radius: 6 }, { center: [4, 144], radius: 6 }],
      water: [],
      hills: [{ at: [0, -10], height: 9, radius: 40 }],
      trees: { count: 50 }, intro: { from: [4, 30, 160], to: [0, 22, -20] } },

    // H6  Par 4  ~330 yd  short, water right all the way, tempts a driver
    { n: 6, par: 4, seed: 106, tee: [0, 0], pin: [10, 300], target: [-2, 208],
      fairway: { path: [[0, 20], [-2, 140], [4, 240], [9, 285]], width: 30 },
      green: { center: [10, 300], radius: 13, tilt: [0.01, 0] }, fringe: 3,
      bunkers: [{ center: [-8, 290], radius: 6 }],
      water: [{ poly: [[30, 40], [80, 40], [80, 330], [30, 330]] }],
      hills: [{ at: [-50, 180], height: 4, radius: 50 }],
      trees: { count: 45 }, intro: { from: [10, 40, 335], to: [0, 18, -25] } },

    // H7  Par 5  ~545 yd  double dogleg (right then left), risky cut over water on shot 2
    { n: 7, par: 5, seed: 107, tee: [0, 0], pin: [-20, 498], target: [22, 300],
      fairway: { path: [[0, 20], [8, 150], [30, 270], [10, 380], [-16, 478]], width: 34 },
      green: { center: [-20, 498], radius: 14, tilt: [0, -0.01] }, fringe: 3,
      bunkers: [{ center: [50, 275], radius: 7 }, { center: [-6, 480], radius: 6 }, { center: [-36, 510], radius: 6 }],
      water: [{ poly: [[-40, 290], [-5, 290], [-5, 360], [-40, 360]] }],
      hills: [{ at: [-60, 150], height: 4, radius: 55 }, { at: [70, 420], height: 5, radius: 50 }],
      trees: { count: 90 }, intro: { from: [-20, 50, 535], to: [0, 22, -30] } },

    // H8  Par 4  ~380 yd  straight, green sits up on a plateau
    { n: 8, par: 4, seed: 108, tee: [0, 0], pin: [2, 348], target: [0, 225],
      fairway: { path: [[0, 20], [0, 200], [2, 330]], width: 34 },
      green: { center: [2, 348], radius: 13, tilt: [0, 0.015] }, fringe: 3,
      bunkers: [{ center: [-16, 340], radius: 6 }, { center: [20, 340], radius: 6 }],
      water: [],
      hills: [{ at: [2, 352], height: 6, radius: 32 }, { at: [55, 120], height: 3, radius: 50 }],
      trees: { count: 60 }, intro: { from: [2, 45, 385], to: [0, 18, -25] } },

    // H9  Par 4  ~420 yd  long finisher, bunkers left, water short-right of green
    { n: 9, par: 4, seed: 109, tee: [0, 0], pin: [-4, 385], target: [-2, 270],
      fairway: { path: [[0, 20], [0, 220], [-3, 365]], width: 34 },
      green: { center: [-4, 385], radius: 14, tilt: [-0.006, -0.006] }, fringe: 3,
      bunkers: [{ center: [-26, 250], radius: 8 }, { center: [-24, 380], radius: 6 }],
      water: [{ poly: [[12, 330], [45, 330], [45, 372], [12, 372]] }],
      hills: [{ at: [45, 180], height: 4, radius: 50 }, { at: [-60, 330], height: 3, radius: 45 }],
      trees: { count: 70 }, intro: { from: [-4, 45, 420], to: [0, 20, -28] } },
  ],
};
