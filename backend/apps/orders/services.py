"""Business logic for orders and assignments.

All multi-step operations are wrapped in ``transaction.atomic`` so the order
update, the immutable assignment history, and the regenerated image succeed or
fail together.
"""
import uuid

from django.core.files.base import ContentFile
from django.db import transaction

from apps.accounts.models import Role, User
from common.enums import Department
from common.exceptions import BusinessRuleError

from .images import generate_order_card_image
from .models import AssignmentHistory, Order

_ROLE_FOR_DEPARTMENT = {
    Department.CUTTING: Role.CUTTING_MAN,
    Department.OPERATOR: Role.OPERATOR,
}


def resolve_assignee(user_id, department: str) -> User:
    """Resolve and validate an employee for a department assignment.

    Raises ``BusinessRuleError`` if the user is missing, has the wrong role, or
    is inactive. This is the single source of truth for assignment validation.
    """
    expected_role = _ROLE_FOR_DEPARTMENT.get(department)
    if expected_role is None:
        raise BusinessRuleError({"department": "Unknown department."})

    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        raise BusinessRuleError({"employee": "Selected employee does not exist."}) from None

    if user.role != expected_role:
        raise BusinessRuleError(
            {
                "employee": (
                    f"Employee must have the {expected_role.replace('_', ' ').title()} "
                    f"role to be assigned to {department.title()}."
                )
            }
        )
    if not user.is_active:
        raise BusinessRuleError({"employee": "Cannot assign an inactive employee."})
    return user


def _generate_and_attach_image(order: Order) -> None:
    """(Re)generate the order-card image from the ORIGINAL upload."""
    original = order.original_image
    original.open("rb")
    try:
        cutting_name = order.cutting_man.full_name if order.cutting_man_id else ""
        operator_name = order.operator.full_name if order.operator_id else ""
        data = generate_order_card_image(original, cutting_name, operator_name)
    finally:
        original.close()

    filename = f"order_card_{uuid.uuid4().hex}.png"
    order.generated_image.save(filename, ContentFile(data), save=False)
    # Persist only the image field to avoid overwriting concurrent changes.
    order.save(update_fields=["generated_image", "updated_at"])


@transaction.atomic
def create_order(
    *,
    order_number: str,
    original_image,
    cutting_man: User,
    operator: User,
    created_by: User,
) -> Order:
    """Create an order with its initial two-department assignment."""
    # Defensive re-validation (serializer already validated, but never trust).
    resolve_assignee(cutting_man.pk, Department.CUTTING)
    resolve_assignee(operator.pk, Department.OPERATOR)

    order = Order(
        order_number=order_number,
        original_image=original_image,
        cutting_man=cutting_man,
        operator=operator,
        created_by=created_by,
    )
    order.save()

    AssignmentHistory.objects.create(
        order=order,
        department=Department.CUTTING,
        previous_employee=None,
        new_employee=cutting_man,
        assigned_by=created_by,
    )
    AssignmentHistory.objects.create(
        order=order,
        department=Department.OPERATOR,
        previous_employee=None,
        new_employee=operator,
        assigned_by=created_by,
    )

    _generate_and_attach_image(order)
    return order


@transaction.atomic
def assign_employee(*, order: Order, department: str, new_employee: User, assigned_by: User) -> Order:
    """Assign or reassign an employee to a department on an order."""
    resolve_assignee(new_employee.pk, department)

    if department == Department.CUTTING:
        current_field = "cutting_man"
    elif department == Department.OPERATOR:
        current_field = "operator"
    else:
        raise BusinessRuleError({"department": "Unknown department."})

    previous = getattr(order, current_field)
    if previous is not None and previous.pk == new_employee.pk:
        raise BusinessRuleError(
            {"employee": "This employee is already assigned to this department."}
        )

    # Immutable history first (previous + new), then current pointer.
    AssignmentHistory.objects.create(
        order=order,
        department=department,
        previous_employee=previous,
        new_employee=new_employee,
        assigned_by=assigned_by,
    )
    setattr(order, current_field, new_employee)
    order.save(update_fields=[current_field, "updated_at"])

    _generate_and_attach_image(order)
    return order