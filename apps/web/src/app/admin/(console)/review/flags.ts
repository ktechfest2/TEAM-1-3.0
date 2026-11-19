/** Plain-language labels for the reasons a polling unit is flagged for review. */
export const FLAG_LABELS: Record<string, string> = {
  shared_network: 'Several witnesses on one network',
  new_evidence_after_resolution: 'New photos after review',
  same_picture_several_numbers: 'Same picture from several numbers',
  burst: 'Burst of numbers from one network',
  out_of_area: 'Capture far from the other witnesses',
};
