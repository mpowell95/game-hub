import harbor from './harbor/course.js';
export const COURSES = [harbor];
export function courseById(id) { return COURSES.find(c => c.id === id) || null; }
