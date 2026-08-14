import BranchRequestQueue from "../../components/BranchRequestQueue";

/** Stage two — the final approval, which releases the stock. Shares the queue
 *  with the Admin portal, which owns stage one. */
const BranchApprovals = () => <BranchRequestQueue stage="Supervisor" />;

export default BranchApprovals;
