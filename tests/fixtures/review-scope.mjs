import { computeReviewScope } from '../../foreman/skills/dispatch/scripts/review-scope.mjs';

try {
  console.log(JSON.stringify(computeReviewScope(JSON.parse(process.argv[2]))));
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
}
