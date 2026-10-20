import 'package:flutter_test/flutter_test.dart';
import 'package:stockmaster/models/purchasing.dart';

void main() {
  group('Purchase Request Sheet row', () {
    test('parses a delivered row with its images and editable columns', () {
      final row = PurchaseRequest.fromJson(const {
        'id': 'PRS-00012',
        'date': '2026-10-18',
        'type': 'Repair Request',
        'company': 'Hi-tech Pretreads',
        'raisedByName': 'Anoop',
        'description': 'Gearbox for the buffing machine\nOil seal',
        'purpose': 'Buffing line stopped',
        'links': 'Kottayam Traders 98470 00000',
        'priority': 'Emergency',
        'approvalStatus': 'Approved',
        'purchaseStatus': 'Delivered',
        'expectedOn': '2026-10-22',
        'receivedOn': '2026-10-21',
        'remarks': '',
        'done': true,
        'raisedBy': 'manager@mannarubber.com',
        'raisedAt': '2026-10-18 09:15:00',
        'updatedBy': 'shantu@mannarubber.com',
        'updatedAt': '2026-10-21 11:00:00',
        'files': '2',
        'editable': ['purchaseStatus', 'remarks', 'expectedOn'],
        'images': [
          {
            'id': 'f1',
            'fileName': 'gearbox.jpg',
            'url': '/private/files/gearbox.jpg',
            'size': 20480,
            'isPrivate': true,
            'addedAt': '2026-10-18 09:16:00',
          },
        ],
      });

      expect(row.id, 'PRS-00012');
      expect(row.date, DateTime(2026, 10, 18));
      expect(row.receivedOn, DateTime(2026, 10, 21));
      expect(row.done, isTrue);
      expect(row.files, 2, reason: 'a numeric string still reads as a number');
      expect(row.imageCount, 1, reason: 'the images themselves win over the list count');
      expect(row.images.single.isPrivate, isTrue);
      expect(row.canEdit('purchaseStatus'), isTrue);
      expect(row.canEdit('approvalStatus'), isFalse);
      expect(row.canAttach, isTrue);
      expect(row.textOf('description'), contains('\n'), reason: 'line breaks are kept');
      expect(row.textOf('images'), '1 image');
      expect(row.withImages(const []).imageCount, 2, reason: 'falls back to the count');
    });

    test('a bare row defaults to a pending, unordered request nobody may change', () {
      final row = PurchaseRequest.fromJson(const {'id': 'PRS-1'});

      expect(row.type, 'Purchase Request');
      expect(row.approvalStatus, 'Pending');
      expect(row.purchaseStatus, 'Not Ordered');
      expect(row.done, isFalse);
      expect(row.date, isNull);
      expect(row.textOf('expectedOn'), '');
      expect(row.editable, isEmpty);
      expect(row.canAttach, isFalse);
      expect(row.images, isEmpty);
    });

    test('search looks across the typed columns, ignoring case', () {
      final row = PurchaseRequest.fromJson(const {
        'id': 'PRS-7',
        'company': 'Soorya Rubbers',
        'raisedByName': 'Bincy',
        'description': 'V-belt B42',
        'links': 'Fenner',
      });

      expect(row.matches(''), isTrue);
      expect(row.matches('fenner'), isTrue);
      expect(row.matches('BINCY'), isTrue);
      expect(row.matches('soorya'), isTrue);
      expect(row.matches('gearbox'), isFalse);
    });
  });

  group('Sheet columns', () {
    test('run in the Google Sheet order, with the images in their place', () {
      expect(sheetColumns.map((c) => c.label), [
        'Date',
        'Type of Request',
        'Company',
        'Raised By',
        'Description',
        'Purpose of Purchase/Repair',
        'Image samples',
        'Links/Brands or vendor contact',
        'Priority',
        'Status of Approval',
        'Status of Purchase/Repair',
        'Expected Date of Arrival',
        'Received date',
        'Remarks',
      ]);
    });
  });

  group('Sheet options', () {
    test('carry the server lists and pick by column', () {
      final options = PurchaseSheetOptions.fromJson(const {
        'types': ['Purchase Request', 'Repair Request'],
        'companies': ['Manna Rubber Products'],
        'priorities': ['Emergency', 'High', 'Medium', 'Low'],
        'approvalStatuses': ['Pending', 'Approved'],
        'purchaseStatuses': ['Not Ordered', 'Received'],
        'doneStatuses': ['Received'],
      });

      expect(options.companies, ['Manna Rubber Products']);
      expect(options.choicesFor('approvalStatus'), ['Pending', 'Approved']);
      expect(options.choicesFor('priority'), hasLength(4));
      expect(options.choicesFor('remarks'), isEmpty);
    });

    test('a list left out falls back to the built-in one', () {
      final options = PurchaseSheetOptions.fromJson(const {'types': []});

      expect(options.types, PurchaseSheetOptions.fallback.types);
      expect(options.companies, PurchaseSheetOptions.fallback.companies);
      expect(options.doneStatuses, ['Received', 'Delivered']);
    });

    test('the companies are taken as sent, so a plant head sees only theirs', () {
      expect(
        PurchaseSheetOptions.fromJson(const {'companies': ['Hi-tech Pretreads']}).companies,
        ['Hi-tech Pretreads'],
      );
      expect(PurchaseSheetOptions.fromJson(const {'companies': []}).companies, isEmpty);
    });
  });
}
