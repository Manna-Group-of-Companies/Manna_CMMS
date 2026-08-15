import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/models/models.dart';

void main() {
  group('Product', () {
    test('parses a full document', () {
      final product = Product.fromJson(const {
        '_id': 'p1',
        'code': 'PRD-100001',
        'name': 'MX Master 3S',
        'category': 'Electronics',
        'quantity': 4,
        'unit': 'Pcs',
        'minStock': 5,
        'maxStock': 100,
        'storeRoom': 'Store Room 1',
        'description': 'Wireless mouse',
        'image': '',
      });

      expect(product.name, 'MX Master 3S');
      expect(product.isPartial, isFalse);
      expect(product.isLowStock, isTrue, reason: 'quantity 4 <= minStock 5');
      expect(product.isOutOfStock, isFalse);
    });

    test('tolerates the partially populated form used by issue history', () {
      final product = Product.fromJson(const {
        '_id': 'p1',
        'name': 'Desk Chair',
        'code': 'PRD-2',
        'unit': 'Pcs',
        'storeRoom': 'Store Room 2',
        'image': '',
      });

      expect(product.isPartial, isTrue);
      expect(product.category, isEmpty);
      expect(product.quantity, 0);
    });
  });

  group('AdminRequest', () {
    Map<String, dynamic> stockOut({required int stock, required int requested}) => {
          '_id': 'r1',
          'requestNumber': 'REQ-OUT-100001',
          'requestType': 'Stock Out',
          'product': {'_id': 'p1', 'name': 'Cable', 'quantity': stock, 'unit': 'Pcs'},
          'quantity': requested,
          'createdDate': '2026-08-11T09:15:00.000Z',
          'status': 'Pending',
          'adminComments': '',
          'supervisor': {'name': 'Sam Store', 'email': 'supervisor@stock.com'},
          'rawType': 'stockout',
        };

    test('flags a stock-out request that would go negative', () {
      final request = AdminRequest.fromJson(stockOut(stock: 3, requested: 10));

      expect(request.exceedsStock, isTrue);
      expect(request.isPending, isTrue);
      expect(request.supervisorName, 'Sam Store');
      expect(request.displayName, 'Cable');
    });

    test('allows a stock-out request within stock', () {
      final request = AdminRequest.fromJson(stockOut(stock: 12, requested: 10));
      expect(request.exceedsStock, isFalse);
    });

    test('uses the drafted details for an Add Product request', () {
      final request = AdminRequest.fromJson(const {
        '_id': 'r2',
        'requestNumber': 'REQ-ADD-100002',
        'requestType': 'Add Product',
        'details': {'name': 'New Monitor', 'quantity': 5, 'unit': 'Pcs'},
        'createdDate': '2026-08-11T09:15:00.000Z',
        'status': 'Pending',
        'rawType': 'product',
      });

      expect(request.displayName, 'New Monitor');
      expect(request.product, isNull);
      expect(request.supervisorName, 'System');
    });
  });

  group('IssueRecord', () {
    test('parses an outstanding issuance', () {
      final issue = IssueRecord.fromJson(const {
        '_id': 'i1',
        'issueNumber': 'ISS-100001',
        'product': {'_id': 'p1', 'name': 'Cable', 'unit': 'Pcs'},
        'quantity': 2,
        'recipient': 'Marketing Dept',
        'purpose': '',
        'supervisor': {'name': 'Sam Store', 'email': 'supervisor@stock.com'},
        'returnStatus': 'Not Returned',
        'createdAt': '2026-08-11T09:15:00.000Z',
      });

      expect(issue.isReturned, isFalse);
      expect(issue.quantity, 2);
      expect(issue.product?.name, 'Cable');
      expect(issue.createdAt, isNotNull);
      expect(issue.outstanding, 2, reason: 'nothing returned yet');
    });

    test('reports what is still outstanding after a partial return', () {
      final issue = IssueRecord.fromJson(const {
        '_id': 'i2',
        'issueNumber': 'ISS-100002',
        'product': {'_id': 'p1', 'name': 'Cable', 'unit': 'Pcs'},
        'quantity': 10,
        'recipient': 'Maintenance',
        'returnStatus': 'Partially Returned',
        'returnedQuantity': 4,
        'createdAt': '2026-08-11T09:15:00.000Z',
      });

      expect(issue.isReturned, isFalse);
      expect(issue.returnedQuantity, 4);
      expect(issue.outstanding, 6);
    });
  });

  group('MyRequest', () {
    Map<String, dynamic> stockIn(Map<String, dynamic> overrides) => {
          '_id': 'q1',
          'requestNumber': 'REQ-IN-801612',
          'requestType': 'Stock In',
          'productName': 'Dell Monitor',
          'quantity': 10,
          'createdDate': '2026-08-11T09:15:00.000Z',
          'status': 'Pending',
          'adminComments': '',
          'rawType': 'stockin',
          ...overrides,
        };

    test('a pending request carries no decision detail', () {
      final request = MyRequest.fromJson(stockIn(const {}));

      expect(request.isPending, isTrue);
      expect(request.displayStatus, 'Pending');
      expect(request.quantity, 10);
      expect(request.approvedQuantity, isNull);
      expect(request.hasDecisionDetail, isFalse);
    });

    test('an approved request reports where the stock landed', () {
      final request = MyRequest.fromJson(stockIn(const {
        'status': 'Approved',
        'approvedQuantity': 10,
        'stockRoom': 'Store Room 1',
        'decidedBy': 'System Admin',
        'approvedAt': '2026-08-12T10:00:00.000Z',
        'adminComments': 'Approved for Q3',
      }));

      expect(request.isApproved, isTrue);
      expect(request.displayStatus, 'Accepted', reason: 'the app says Accepted');
      expect(request.stockRoom, 'Store Room 1');
      expect(request.decidedBy, 'System Admin');
      expect(request.approvedAt, isNotNull);
      expect(request.hasDecisionDetail, isTrue);
    });

    test('a partial approval keeps both the asked-for and granted amounts', () {
      final request = MyRequest.fromJson(stockIn(const {
        'status': 'Approved',
        'approvedQuantity': 4,
        'stockRoom': 'Store Room 2',
      }));

      expect(request.quantity, 10);
      expect(request.approvedQuantity, 4);
    });

    test('a rejected request reports who turned it down', () {
      final request = MyRequest.fromJson(stockIn(const {
        'status': 'Rejected',
        'adminComments': 'Requested quantity not available.',
        'decidedBy': 'System Admin',
        'rejectedAt': '2026-08-12T10:00:00.000Z',
      }));

      expect(request.isRejected, isTrue);
      expect(request.displayStatus, 'Rejected');
      expect(request.approvedQuantity, isNull, reason: 'nothing was granted');
      expect(request.stockRoom, isEmpty, reason: 'no room was credited');
      expect(request.hasDecisionDetail, isTrue);
    });

    test('request types without a quantity still parse', () {
      final request = MyRequest.fromJson(const {
        '_id': 'q2',
        'requestNumber': 'REQ-ADD-100001',
        'requestType': 'Add Product',
        'productName': 'New Chair',
        'status': 'Pending',
        'rawType': 'product',
      });

      expect(request.quantity, 0);
      expect(request.hasDecisionDetail, isFalse);
    });
  });

  group('RoomInventory', () {
    test('parses a room with its stock', () {
      final room = RoomInventory.fromJson(const {
        '_id': 'sr1',
        'name': 'Store Room 1',
        'itemCount': 2,
        'totalQuantity': 43,
        'items': [
          {
            'productId': 'p1', 'name': 'Dell Monitor', 'code': 'MON-001',
            'unit': 'Pcs', 'quantity': 18, 'isLowStock': false,
          },
          {
            'productId': 'p2', 'name': 'Keyboard', 'code': 'KB-001',
            'unit': 'Pcs', 'quantity': 25, 'isLowStock': true,
          },
        ],
      });

      expect(room.name, 'Store Room 1');
      expect(room.totalQuantity, 43);
      expect(room.items.length, 2);
      expect(room.items.first.quantity, 18);
      expect(room.items.last.isLowStock, isTrue);
    });

    test('tolerates an empty room', () {
      final room = RoomInventory.fromJson(const {'_id': 'sr2', 'name': 'Store Room 2'});

      expect(room.items, isEmpty);
      expect(room.totalQuantity, 0);
    });
  });

  group('RestockRecord', () {
    test('parses a batch still waiting on the weekly merge', () {
      final item = RestockRecord.fromJson(const {
        '_id': 'rs1',
        'restockNumber': 'RT-100001',
        'product': {
          '_id': 'p1',
          'name': 'Cable',
          'code': 'PRD-1',
          'unit': 'Pcs',
          'storeRoom': 'Store Room 2',
          'image': '',
        },
        'productName': 'Cable',
        'productCode': 'PRD-1',
        'unit': 'Pcs',
        'quantity': 4,
        'reason': 'Job completed',
        'condition': 'Good',
        'department': 'Maintenance',
        'status': 'Restock Pending',
        'returnDate': '2026-08-11T09:15:00.000Z',
      });

      expect(item.awaitingMerge, isTrue);
      expect(item.isMerged, isFalse);
      expect(item.destinationStoreRoom, 'Store Room 2');
      expect(item.mergeRequestId, isEmpty);
    });

    test('surfaces the merge id once the item is locked to a request', () {
      final item = RestockRecord.fromJson(const {
        '_id': 'rs2',
        'restockNumber': 'RT-100002',
        'productName': 'Cable',
        'quantity': 2,
        'reason': 'Surplus',
        'status': 'Merge Requested',
        'mergeRequest': {'_id': 'm1', 'requestId': 'MERGE-202608-001'},
      });

      expect(item.mergeRequestId, 'MERGE-202608-001');
      expect(item.awaitingMerge, isFalse, reason: 'already locked to a merge');
      expect(item.destinationStoreRoom, isEmpty, reason: 'product not populated');
    });
  });

  group('ProductDraft', () {
    test('round-trips a product into an edit payload', () {
      const product = Product(
        id: 'p1',
        code: 'PRD-1',
        name: 'Chair',
        category: 'Furniture',
        rackNumber: 'B-4',
        quantity: 9,
        unit: 'Pcs',
        minStock: 2,
        maxStock: 40,
        storeRoom: 'Store Room 2',
        description: 'Ergonomic',
        image: '',
        isPartial: false,
      );

      final json = ProductDraft.fromProduct(product).toJson();

      expect(json['name'], 'Chair');
      expect(json['storeRoom'], 'Store Room 2');
      expect(json['minStock'], 2);
      // The API derives `code` itself; it must not be sent back.
      expect(json.containsKey('code'), isFalse);
    });
  });
}
