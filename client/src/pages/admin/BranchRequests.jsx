import BranchRequestQueue from "../../components/BranchRequestQueue";

/** Stage one of the branch workflow. The queue itself is shared with the
 *  Supervisor portal, which owns stage two. */
const BranchRequests = () => <BranchRequestQueue stage="Admin" />;

export default BranchRequests;
